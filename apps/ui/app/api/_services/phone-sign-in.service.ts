import 'server-only'
import { randomBytes } from 'node:crypto'
import type { Database } from '@/app/api/database.types'
import { phoneOwnerId, phoneStandingFor, UNIQUE_VIOLATION, type PhoneAccount } from '@/app/api/_services/phone-ownership.service'
import { sendStanding, SEND_WINDOW_MS, type PhoneRefusal } from '@/app/api/_services/phone-verification.service'
import { callerRateKey } from '@/lib/auth/caller-ip'
import { isPlaceholderEmail, placeholderEmailFor } from '@/lib/auth/placeholder-email'
import { isVerificationChannel, type VerificationChannel } from '@/lib/phone/verification'
import { checkVerification, sendVerification, type VerificationFailure } from '@/lib/sms/bird-verify'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { ClientPlatform } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

const SEND_COLUMNS = ['phone', 'send_count', 'send_window_started_at', 'last_sent_at', 'last_channel'] as const

// Wide enough for an office behind one address, and for everybody on a busy day: a script meets
// the first, and many scripts together meet the second, which is what bounds the bill.
export const MAX_SENDS_PER_IP = 10
export const MAX_SENDS_EVERYONE = 400
// The app has no captcha in front of its sends, so a script on its routes runs out well before everybody's.
export const MAX_SENDS_FROM_APP = 100
// Tries at a code, before anything is compared: a six-digit code does not survive a loop. Bird counts
// its own tries too; the App Review code has nothing else.
export const MAX_VERIFY_PER_PHONE = 5
export const MAX_VERIFY_PER_IP = 20
export const VERIFY_WINDOW_MS = 15 * 60_000

export type SignInApp = ClientPlatform

type SendUpsert = Database['public']['Tables']['phone_sign_in_sends']['Insert']
type SendUpdate = Database['public']['Tables']['phone_sign_in_sends']['Update']

export type PhoneSignInFailure = VerificationFailure | 'too_soon' | 'too_many' | 'busy'
export type PhoneSignInStart = { ok: true; channel: VerificationChannel } | PhoneRefusal<PhoneSignInFailure>
export type SessionTokens = { accessToken: string; refreshToken: string }
export type PhoneSignInResult = { ok: true; created: boolean; session: SessionTokens } | PhoneRefusal<PhoneSignInFailure>

const refused = <Failure extends string>(error: Failure, retryAfterSeconds?: number): PhoneRefusal<Failure> => ({
    ok: false,
    error,
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
})

// `phone` is E.164 already. Nobody is signed in yet, so the sends are counted per number. A send
// is counted before it leaves and given back when nothing went out.
// The caller's and everybody's counts are not given back: an attempt is what they measure.
// `account` is who asks, when someone signed in is moving to this number. `app` is set when the code is
// asked from the mobile app rather than the web.
export async function startPhoneSignIn(phone: string, channel: VerificationChannel, ip: string, language: string | null = null, account: { id: string; context: 'settings' } | null = null, app: SignInApp | null = null): Promise<PhoneSignInStart> {
    const supabase = createServiceRoleClient()
    const { data: row, error: readError } = await selectMaybeSingle(supabase, 'phone_sign_in_sends', SEND_COLUMNS, { phone })
    if (readError) return refused('unavailable')

    const now = Date.now()
    const previousChannel = isVerificationChannel(row?.last_channel) ? row.last_channel : null
    const lastSentAt = row?.last_sent_at ?? null
    const standing = sendStanding({ lastSentAt, lastChannel: previousChannel, sendCount: row?.send_count ?? 0, windowStartedAt: row?.send_window_started_at ?? null }, channel, now)
    if (standing.refusal) return refused(standing.refusal, standing.retryAfterSeconds)

    const limits = { p_ip: callerRateKey(ip), p_ip_max: MAX_SENDS_PER_IP, p_global_max: MAX_SENDS_EVERYONE, p_window_seconds: SEND_WINDOW_MS / 1000 }
    const { data: claim, error: claimError } = await supabase.rpc('claim_phone_sign_in_send', app ? { ...limits, p_app: app, p_app_max: MAX_SENDS_FROM_APP } : limits)
    if (claim === 'ip') return refused('too_many')
    if (claim === 'global' || claim === 'app') {
        console.error(`[phone-sign-in] the cap on codes sent ${claim === 'app' ? 'from the app' : 'to everybody'} is reached`)
        return refused('busy')
    }
    if (claimError || claim !== 'ok') return refused('unavailable')

    const stamp = new Date(now).toISOString()
    const { error } = await supabase.from('phone_sign_in_sends').upsert<SendUpsert>(
        {
            phone,
            send_count: standing.sentInWindow + 1,
            send_window_started_at: standing.windowIsOpen ? row?.send_window_started_at : stamp,
            last_sent_at: stamp,
            last_channel: channel,
        },
        { onConflict: 'phone' }
    )
    if (error) return refused('unavailable')

    const metadata = account ? { context: account.context, user_id: account.id } : { context: 'sign_in' }
    const sent = await sendVerification(phone, channel, { language, previousChannel, lastSentAt, metadata })
    if (sent.ok) {
        // The ledger keeps where the code went, which is what the next switch moves away from.
        if (sent.channel !== channel) await supabase.from('phone_sign_in_sends').update<SendUpdate>({ last_channel: sent.channel }).eq('phone', phone)
        return sent
    }

    await supabase.from('phone_sign_in_sends').upsert<SendUpsert>(
        {
            phone,
            send_count: row?.send_count ?? 0,
            send_window_started_at: row?.send_window_started_at ?? null,
            last_sent_at: row?.last_sent_at ?? null,
            last_channel: row?.last_channel ?? null,
        },
        { onConflict: 'phone' }
    )
    return sent
}

async function accountEmailFor(admin: SupabaseClient<Database>, phone: string): Promise<{ email: string | null } | null> {
    const owner = await phoneOwnerId(admin, phone)
    if (!owner) return null
    if (!owner.userId) return { email: null }
    const { data } = await admin.auth.admin.getUserById(owner.userId)
    return data.user?.email ? { email: data.user.email } : null
}

type CreatedAccount = { email: string; adopted: boolean }

// A number no account holds yet becomes one. The anonymous visitor who typed it keeps their id, so
// the workspace and the draft they built stay theirs; with no visitor behind the request the
// account is created outright. Either way it is filed under the number's placeholder address.
async function createAccount(admin: SupabaseClient<Database>, session: SupabaseClient<Database>, phone: string): Promise<CreatedAccount | null> {
    const email = placeholderEmailFor(phone)
    const { data: current } = await session.auth.getUser()
    const visitor = current.user?.is_anonymous ? current.user : null

    const { data, error } = visitor ? await admin.auth.admin.updateUserById(visitor.id, { email, email_confirm: true }) : await admin.auth.admin.createUser({ email, email_confirm: true })
    // The address is the number's own, so one that is taken is this number's account: left without
    // its phone row by an earlier attempt that failed halfway, or planted through the public signup
    // by someone who guessed the address. The number was just proved, so it is adopted either way.
    if (error?.code === 'email_exists') return { email, adopted: true }
    if (error || !data.user) {
        console.error('[phone-sign-in] account creation failed', error?.message)
        return null
    }
    return { email, adopted: false }
}

// An admin only ever sets a password on a real address, never on a phone placeholder, so one found
// on an adopted account was planted by whoever filed the address first. Overwritten with a value
// nobody knows before the owner of the number gets the account, so the planter is locked out.
async function scramblePassword(admin: SupabaseClient<Database>, userId: string): Promise<boolean> {
    const { error } = await admin.auth.admin.updateUserById(userId, { password: randomBytes(32).toString('base64url') })
    if (error) console.error('[phone-sign-in] password scramble failed', error.message)
    return !error
}

// Supabase opens a session for a code it issued itself, and this one was issued by Bird: once Bird
// has confirmed it, a one-time sign-in token is minted for the account. Nothing is mailed.
async function mintSignInToken(admin: SupabaseClient<Database>, email: string): Promise<{ userId: string; tokenHash: string } | null> {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const tokenHash = data.properties?.hashed_token
    if (error || !tokenHash || !data.user) {
        console.error('[phone-sign-in] token failed', error?.message)
        return null
    }
    return { userId: data.user.id, tokenHash }
}

// Written before the session opens, so the phone step of a signup never asks for a number that
// just signed the account in, whether the account was born now or by an attempt that failed halfway.
async function writeVerifiedPhone(admin: SupabaseClient<Database>, userId: string, phone: string, channel: VerificationChannel): Promise<boolean> {
    const stamp = new Date().toISOString()
    const { error } = await admin
        .from('user_phones')
        .upsert<Database['public']['Tables']['user_phones']['Insert']>({ user_id: userId, phone, channel, verified_at: stamp, contact_consent_at: stamp }, { onConflict: 'user_id' })
    if (error) console.error('[phone-sign-in] phone row failed', error.message)
    return !error
}

// The token is spent by the request's own client, which sets the session cookies. Its tokens are
// handed back as well: a browser that cannot read those cookies yet (an in-app browser) would
// otherwise put its anonymous session back on top of them.
async function openSession(session: SupabaseClient<Database>, tokenHash: string): Promise<SessionTokens | null> {
    const { data, error } = await session.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
    if (error || !data.session) {
        console.error('[phone-sign-in] session failed', error?.message)
        return null
    }
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token }
}

export type VerifyAttempt = 'ok' | 'too_many' | 'unavailable'

// One try taken out of the number's window and the caller's, whatever the code turns out to be.
export async function countVerifyAttempt(phone: string, ip: string): Promise<VerifyAttempt> {
    const { data, error } = await createServiceRoleClient().rpc('claim_phone_sign_in_verify', { p_phone: phone, p_ip: callerRateKey(ip), p_phone_max: MAX_VERIFY_PER_PHONE, p_ip_max: MAX_VERIFY_PER_IP, p_window_seconds: VERIFY_WINDOW_MS / 1000 })
    if (data === 'phone' || data === 'ip') return 'too_many'
    if (error || data !== 'ok') return 'unavailable'
    return 'ok'
}

// `session` is the client of the request, the one that reads and writes its cookies.
export async function completePhoneSignIn(session: SupabaseClient<Database>, phone: string, code: string, channel: VerificationChannel): Promise<PhoneSignInResult> {
    const checked = await checkVerification(phone, code)
    if (!checked.ok) return checked
    return signInWithNumber(session, phone, channel)
}

// The number given to App Review, whose fixed code the caller has already compared.
export async function completeAppReviewSignIn(session: SupabaseClient<Database>, phone: string): Promise<PhoneSignInResult> {
    return signInWithNumber(session, phone, 'sms')
}

async function signInWithNumber(session: SupabaseClient<Database>, phone: string, channel: VerificationChannel): Promise<PhoneSignInResult> {
    const admin = createServiceRoleClient()
    const account = await accountEmailFor(admin, phone)
    if (!account) return refused('unavailable')

    const created = account.email ? null : await createAccount(admin, session, phone)
    const email = account.email ?? created?.email ?? null
    const token = email ? await mintSignInToken(admin, email) : null
    if (!token) return refused('unavailable')
    if (created?.adopted && !(await scramblePassword(admin, token.userId))) return refused('unavailable')
    if (!account.email && !(await writeVerifiedPhone(admin, token.userId, phone, channel))) return refused('unavailable')

    const tokens = await openSession(session, token.tokenHash)
    if (!tokens) return refused('unavailable')
    return { ok: true, created: !account.email, session: tokens }
}

export type PhoneChangeFailure = PhoneSignInFailure | 'taken' | 'same_number'
export type PhoneChangeStart = { ok: true; channel: VerificationChannel } | PhoneRefusal<PhoneChangeFailure>
export type PhoneChangeResult = { ok: true } | PhoneRefusal<PhoneChangeFailure>

// Nothing is written on the account until the code proves the number: its verified row keeps the
// old one, so the phone step of the signup never comes back up while a change is under way. The
// sends are counted per number, on the ledger signing in already keeps.
export async function startPhoneChange(account: PhoneAccount, phone: string, channel: VerificationChannel, ip: string, language: string | null = null): Promise<PhoneChangeStart> {
    const standing = await phoneStandingFor(createServiceRoleClient(), account, phone)
    if (standing !== 'free') return refused(standing)
    return startPhoneSignIn(phone, channel, ip, language, { id: account.id, context: 'settings' })
}

export async function completePhoneChange(account: PhoneAccount, phone: string, code: string, channel: VerificationChannel): Promise<PhoneChangeResult> {
    const admin = createServiceRoleClient()
    const standing = await phoneStandingFor(admin, account, phone)
    if (standing !== 'free') return refused(standing)

    const checked = await checkVerification(phone, code)
    if (!checked.ok) return checked

    // A phone-born account is filed under its number. Left under the old one, it would be opened by
    // whoever proves that number next, and would go on showing it as its label.
    if (isPlaceholderEmail(account.email)) {
        const { error } = await admin.auth.admin.updateUserById(account.id, { email: placeholderEmailFor(phone), email_confirm: true })
        if (error) {
            if (error.code === 'email_exists') return refused('taken')
            console.error('[phone-change] placeholder move failed', error.message)
            return refused('unavailable')
        }
    }

    const stamp = new Date().toISOString()
    const { error } = await admin.from('user_phones').upsert<Database['public']['Tables']['user_phones']['Insert']>({ user_id: account.id, phone, channel, verified_at: stamp, contact_consent_at: stamp }, { onConflict: 'user_id' })
    if (error) {
        if (error.code === UNIQUE_VIOLATION) return refused('taken')
        console.error('[phone-change] phone row failed', error.message)
        return refused('unavailable')
    }
    return { ok: true }
}
