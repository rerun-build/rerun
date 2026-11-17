import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/app/api/database.types'
import { fakeSupabase, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))

const sendVerification = vi.fn()
const checkVerification = vi.fn()
vi.mock('@/lib/sms/bird-verify', async importOriginal => ({
    ...(await importOriginal<object>()),
    sendVerification: (...args: unknown[]) => sendVerification(...args),
    checkVerification: (...args: unknown[]) => checkVerification(...args),
}))

const admin = { getUserById: vi.fn(), updateUserById: vi.fn(), createUser: vi.fn(), generateLink: vi.fn() }
let supabase = fakeSupabase()
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => Object.assign(supabase.client, { auth: { admin } }) }))

const NOW = Date.parse('2026-10-07T12:00:00Z')
const STAMP = new Date(NOW).toISOString()
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const PHONE = '+33612345678'
const PLACEHOLDER = '33612345678@phone.rerun.build'

const CLAIM = 'rpc:claim_phone_sign_in_send'

const stored = (tables: { sends?: object | null; owners?: object[]; claim?: string; placeholderHeld?: boolean }) => {
    supabase = fakeSupabase(table => {
        if (table === 'phone_sign_in_sends') return { data: tables.sends ?? null }
        if (table === 'user_phones') return { data: tables.owners ?? [] }
        if (table === CLAIM) return { data: tables.claim ?? 'ok' }
        if (table === 'rpc:check_email_exists') return { data: tables.placeholderHeld ?? false }
        return undefined
    })
}

const IP = '203.0.113.7'

const sends = (client: FakeSupabase) => client.writes('phone_sign_in_sends').map(write => write.payload)

const getUser = vi.fn()
const verifyOtp = vi.fn()
const TOKENS = { accessToken: 'access', refreshToken: 'refresh' }
// generateLink answers for the account the address is filed under, whoever it turns out to be.
const linkFor = (userId: string) => ({ data: { user: { id: userId }, properties: { hashed_token: 'hash' } }, error: null })
const session = { auth: { getUser, verifyOtp } } as unknown as SupabaseClient<Database>

const { completePhoneChange, completePhoneSignIn, countVerifyAttempt, startPhoneChange, startPhoneSignIn } = await import('./phone-sign-in.service')

beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    for (const mock of [sendVerification, checkVerification, getUser, verifyOtp, ...Object.values(admin)]) mock.mockReset()
    sendVerification.mockResolvedValue({ ok: true, channel: 'sms' })
    checkVerification.mockResolvedValue({ ok: true })
    getUser.mockResolvedValue({ data: { user: null } })
    verifyOtp.mockResolvedValue({ data: { session: { access_token: 'access', refresh_token: 'refresh' } }, error: null })
    admin.generateLink.mockResolvedValue(linkFor('user-1'))
})

describe('startPhoneSignIn', () => {
    it('sends a first code to a number never seen', async () => {
        stored({})

        sendVerification.mockResolvedValue({ ok: true, channel: 'whatsapp' })

        expect(await startPhoneSignIn(PHONE, 'whatsapp', IP, 'fr-BE')).toEqual({ ok: true, channel: 'whatsapp' })

        expect(sendVerification).toHaveBeenCalledWith(PHONE, 'whatsapp', { language: 'fr-BE', previousChannel: null, lastSentAt: null, metadata: { context: 'sign_in' } })
        expect(sends(supabase)).toEqual([{ phone: PHONE, send_count: 1, send_window_started_at: STAMP, last_sent_at: STAMP, last_channel: 'whatsapp' }])
    })

    it('holds a second code on the same channel back for a minute, and says how long is left', async () => {
        stored({ sends: { phone: PHONE, send_count: 1, send_window_started_at: minutesAgo(0.5), last_sent_at: minutesAgo(0.5), last_channel: 'sms' } })

        expect(await startPhoneSignIn(PHONE, 'sms', IP)).toEqual({ ok: false, error: 'too_soon', retryAfterSeconds: 30 })
        expect(sendVerification).not.toHaveBeenCalled()
    })

    it('moves to the other channel after 20 seconds, on the verification in progress', async () => {
        stored({ sends: { phone: PHONE, send_count: 1, send_window_started_at: minutesAgo(0.25), last_sent_at: minutesAgo(0.25), last_channel: 'whatsapp' } })
        expect(await startPhoneSignIn(PHONE, 'sms', IP)).toEqual({ ok: false, error: 'too_soon', retryAfterSeconds: 5 })
        expect(sendVerification).not.toHaveBeenCalled()

        stored({ sends: { phone: PHONE, send_count: 1, send_window_started_at: minutesAgo(0.5), last_sent_at: minutesAgo(0.5), last_channel: 'whatsapp' } })
        expect(await startPhoneSignIn(PHONE, 'sms', IP)).toEqual({ ok: true, channel: 'sms' })
        expect(sendVerification).toHaveBeenCalledWith(PHONE, 'sms', expect.objectContaining({ previousChannel: 'whatsapp', lastSentAt: minutesAgo(0.5) }))
        expect(sends(supabase)[0]).toMatchObject({ send_count: 2, last_channel: 'sms' })
    })

    it('keeps the channel the code really went by, when Bird kept it on the other one', async () => {
        stored({ sends: { phone: PHONE, send_count: 1, send_window_started_at: minutesAgo(2), last_sent_at: minutesAgo(2), last_channel: 'sms' } })
        sendVerification.mockResolvedValue({ ok: true, channel: 'sms' })

        expect(await startPhoneSignIn(PHONE, 'whatsapp', IP)).toEqual({ ok: true, channel: 'sms' })
        expect(sends(supabase)).toEqual([expect.objectContaining({ send_count: 2, last_channel: 'whatsapp' }), { last_channel: 'sms' }])
    })

    it('relays the wait Bird asks for on a switch with nowhere to go, and gives the send back', async () => {
        const before = { phone: PHONE, send_count: 2, send_window_started_at: minutesAgo(30), last_sent_at: minutesAgo(0.5), last_channel: 'sms' }
        stored({ sends: before })
        sendVerification.mockResolvedValue({ ok: false, error: 'too_soon', retryAfterSeconds: 30 })

        expect(await startPhoneSignIn(PHONE, 'whatsapp', IP)).toEqual({ ok: false, error: 'too_soon', retryAfterSeconds: 30 })
        expect(sends(supabase).at(-1)).toEqual(before)
    })

    it('stops at five codes an hour for a number, until its window closes', async () => {
        stored({ sends: { phone: PHONE, send_count: 5, send_window_started_at: minutesAgo(30), last_sent_at: minutesAgo(2) } })

        expect(await startPhoneSignIn(PHONE, 'sms', IP)).toEqual({ ok: false, error: 'too_many', retryAfterSeconds: 30 * 60 })
        expect(sendVerification).not.toHaveBeenCalled()
    })

    it("takes a send out of the caller's window and everybody's", async () => {
        stored({})

        await startPhoneSignIn(PHONE, 'sms', '2a01:cb00:1234:5678:aaaa:bbbb:cccc:dddd')

        expect(supabase.chainsOn(CLAIM)[0][0].args).toEqual(['claim_phone_sign_in_send', { p_ip: '2a01:cb00:1234:5678::/64', p_ip_max: 10, p_global_max: 400, p_window_seconds: 3600 }])
    })

    it('stops a caller who has used up their window, whatever the number', async () => {
        stored({ claim: 'ip' })

        expect(await startPhoneSignIn(PHONE, 'sms', IP)).toEqual({ ok: false, error: 'too_many' })
        expect(sendVerification).not.toHaveBeenCalled()
        expect(sends(supabase)).toEqual([])
    })

    it('stops everybody once the cap on all sends is reached', async () => {
        stored({ claim: 'global' })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await startPhoneSignIn(PHONE, 'sms', IP)).toEqual({ ok: false, error: 'busy' })
        expect(sendVerification).not.toHaveBeenCalled()
    })

    it('counts a code asked from the app in a window of its own, smaller than everybody\'s', async () => {
        stored({})

        await startPhoneSignIn(PHONE, 'sms', IP, null, null, 'ios')

        expect(supabase.chainsOn(CLAIM)[0][0].args[1]).toMatchObject({ p_app: 'ios', p_app_max: 100, p_global_max: 400 })
    })

    it('stops the app once its own window is full, and sends nothing', async () => {
        stored({ claim: 'app' })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await startPhoneSignIn(PHONE, 'sms', IP, null, null, 'ios')).toEqual({ ok: false, error: 'busy' })
        expect(sendVerification).not.toHaveBeenCalled()
    })

    it('takes nothing out of those windows for a code the number is refused', async () => {
        stored({ sends: { phone: PHONE, send_count: 1, send_window_started_at: minutesAgo(0.5), last_sent_at: minutesAgo(0.5) } })

        await startPhoneSignIn(PHONE, 'sms', IP)

        expect(supabase.chainsOn(CLAIM)).toEqual([])
    })

    it('gives the send back when nothing reached the phone', async () => {
        const before = { phone: PHONE, send_count: 2, send_window_started_at: minutesAgo(30), last_sent_at: minutesAgo(2), last_channel: 'whatsapp' }
        stored({ sends: before })
        sendVerification.mockResolvedValue({ ok: false, error: 'invalid_number' })

        expect(await startPhoneSignIn(PHONE, 'sms', IP)).toEqual({ ok: false, error: 'invalid_number' })
        expect(sends(supabase)).toEqual([{ ...before, send_count: 3, last_sent_at: STAMP, last_channel: 'sms' }, before])
    })
})

describe('completePhoneSignIn', () => {
    it('opens no session on a wrong code', async () => {
        stored({})
        checkVerification.mockResolvedValue({ ok: false, error: 'wrong_code' })

        expect(await completePhoneSignIn(session, PHONE, '000000', 'sms')).toEqual({ ok: false, error: 'wrong_code' })
        expect(admin.generateLink).not.toHaveBeenCalled()
        expect(verifyOtp).not.toHaveBeenCalled()
    })

    it('signs into the account that holds the number, under its own address', async () => {
        stored({ owners: [{ user_id: 'user-1' }] })
        admin.getUserById.mockResolvedValue({ data: { user: { id: 'user-1', email: 'ada@rerun.build' } } })

        expect(await completePhoneSignIn(session, PHONE, '123456', 'sms')).toEqual({ ok: true, created: false, session: TOKENS })

        expect(admin.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'ada@rerun.build' })
        expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash', type: 'magiclink' })
        expect(admin.createUser).not.toHaveBeenCalled()
        expect(supabase.writes('user_phones')).toEqual([])
    })

    it('creates the account of a number nobody holds, already verified', async () => {
        stored({})
        admin.createUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null })
        admin.generateLink.mockResolvedValue(linkFor('user-2'))

        expect(await completePhoneSignIn(session, PHONE, '123456', 'whatsapp')).toEqual({ ok: true, created: true, session: TOKENS })

        expect(admin.createUser).toHaveBeenCalledWith({ email: PLACEHOLDER, email_confirm: true })
        expect(supabase.writes('user_phones').map(write => write.payload)).toEqual([{ user_id: 'user-2', phone: PHONE, channel: 'whatsapp', verified_at: STAMP, contact_consent_at: STAMP }])
        expect(admin.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: PLACEHOLDER })
    })

    it('signs into an account left without its phone row by an attempt that failed halfway', async () => {
        stored({})
        admin.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'taken' } })
        admin.generateLink.mockResolvedValue(linkFor('user-3'))
        admin.updateUserById.mockResolvedValue({ data: { user: { id: 'user-3' } }, error: null })

        expect(await completePhoneSignIn(session, PHONE, '123456', 'sms')).toEqual({ ok: true, created: true, session: TOKENS })
        expect(admin.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: PLACEHOLDER })
        // Without its verified row, the phone wall would rise again on the account it just opened.
        expect(supabase.writes('user_phones').map(write => write.payload)).toEqual([{ user_id: 'user-3', phone: PHONE, channel: 'sms', verified_at: STAMP, contact_consent_at: STAMP }])
    })

    it('locks whoever planted a password on the placeholder out of the adopted account', async () => {
        stored({})
        admin.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'taken' } })
        admin.generateLink.mockResolvedValue(linkFor('user-3'))
        admin.updateUserById.mockResolvedValue({ data: { user: { id: 'user-3' } }, error: null })

        await completePhoneSignIn(session, PHONE, '123456', 'sms')

        expect(admin.updateUserById).toHaveBeenCalledTimes(1)
        const [userId, attributes] = admin.updateUserById.mock.calls[0]
        expect(userId).toBe('user-3')
        expect(attributes.password).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    })

    it('opens no session on an adopted account whose password could not be scrambled', async () => {
        stored({})
        admin.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'taken' } })
        admin.generateLink.mockResolvedValue(linkFor('user-3'))
        admin.updateUserById.mockResolvedValue({ data: { user: null }, error: { code: 'unexpected_failure', message: 'down' } })

        expect(await completePhoneSignIn(session, PHONE, '123456', 'sms')).toEqual({ ok: false, error: 'unavailable' })
        expect(supabase.writes('user_phones')).toEqual([])
        expect(verifyOtp).not.toHaveBeenCalled()
    })

    it('leaves the password of an account it just created alone', async () => {
        stored({})
        admin.createUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null })
        admin.generateLink.mockResolvedValue(linkFor('user-2'))

        expect(await completePhoneSignIn(session, PHONE, '123456', 'sms')).toEqual({ ok: true, created: true, session: TOKENS })
        expect(admin.updateUserById).not.toHaveBeenCalled()
    })

    it('opens no session on an account whose phone row could not be written', async () => {
        supabase = fakeSupabase((table, calls) => (table === 'user_phones' && writeMethodOf(calls) ? { error: { code: '23505', message: 'duplicate key' } } : table === 'user_phones' ? { data: [] } : undefined))
        admin.createUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null })
        admin.generateLink.mockResolvedValue(linkFor('user-2'))
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await completePhoneSignIn(session, PHONE, '123456', 'sms')).toEqual({ ok: false, error: 'unavailable' })
        expect(verifyOtp).not.toHaveBeenCalled()
    })

    it('answers unavailable when the session cannot be opened', async () => {
        stored({ owners: [{ user_id: 'user-1' }] })
        admin.getUserById.mockResolvedValue({ data: { user: { id: 'user-1', email: 'ada@rerun.build' } } })
        verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'nope' } })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await completePhoneSignIn(session, PHONE, '123456', 'sms')).toEqual({ ok: false, error: 'unavailable' })
    })
})

const ACCOUNT = { id: 'user-1', email: 'ada@rerun.build' }
const PHONE_BORN = { id: 'user-1', email: '33700000000@phone.rerun.build' }

describe('startPhoneChange', () => {
    it('sends a code to a number nobody signs in with', async () => {
        stored({})

        expect(await startPhoneChange(ACCOUNT, PHONE, 'sms', IP, 'fr-BE')).toEqual({ ok: true, channel: 'sms' })
        expect(sendVerification).toHaveBeenCalledWith(PHONE, 'sms', { language: 'fr-BE', previousChannel: null, lastSentAt: null, metadata: { context: 'settings', user_id: ACCOUNT.id } })
        expect(supabase.writes('user_phones')).toEqual([])
    })

    it('refuses a number that already signs into another account', async () => {
        stored({ owners: [{ user_id: 'someone-else' }] })

        expect(await startPhoneChange(ACCOUNT, PHONE, 'sms', IP)).toEqual({ ok: false, error: 'taken' })
        expect(sendVerification).not.toHaveBeenCalled()
    })

    it('refuses a number a phone-born account is still filed under, even without its phone row', async () => {
        stored({ placeholderHeld: true })

        expect(await startPhoneChange(ACCOUNT, PHONE, 'sms', IP)).toEqual({ ok: false, error: 'taken' })
        expect(sendVerification).not.toHaveBeenCalled()
    })

    it('says so when the number is already the one of the account', async () => {
        stored({ owners: [{ user_id: 'user-1' }] })

        expect(await startPhoneChange(ACCOUNT, PHONE, 'sms', IP)).toEqual({ ok: false, error: 'same_number' })
        expect(sendVerification).not.toHaveBeenCalled()
    })
})

describe('completePhoneChange', () => {
    it('writes the number verified once the code proves it', async () => {
        stored({})

        expect(await completePhoneChange(ACCOUNT, PHONE, '123456', 'whatsapp')).toEqual({ ok: true })

        expect(supabase.writes('user_phones').map(write => write.payload)).toEqual([{ user_id: 'user-1', phone: PHONE, channel: 'whatsapp', verified_at: STAMP, contact_consent_at: STAMP }])
        expect(admin.updateUserById).not.toHaveBeenCalled()
    })

    it('leaves the account as it was on a wrong code', async () => {
        stored({})
        checkVerification.mockResolvedValue({ ok: false, error: 'wrong_code' })

        expect(await completePhoneChange(ACCOUNT, PHONE, '000000', 'sms')).toEqual({ ok: false, error: 'wrong_code' })
        expect(supabase.writes('user_phones')).toEqual([])
    })

    it('refuses a number taken while the code was on its way, without spending the code', async () => {
        stored({ owners: [{ user_id: 'someone-else' }] })

        expect(await completePhoneChange(ACCOUNT, PHONE, '123456', 'sms')).toEqual({ ok: false, error: 'taken' })
        expect(checkVerification).not.toHaveBeenCalled()
        expect(supabase.writes('user_phones')).toEqual([])
    })

    it('says the number is taken when another account verified it in the same instant', async () => {
        supabase = fakeSupabase((table, calls) => (table === 'user_phones' && writeMethodOf(calls) ? { error: { code: '23505', message: 'duplicate key' } } : table === 'user_phones' ? { data: [] } : undefined))

        expect(await completePhoneChange(ACCOUNT, PHONE, '123456', 'sms')).toEqual({ ok: false, error: 'taken' })
    })

    it('files a phone-born account under its new number, so the old one no longer opens it', async () => {
        stored({})
        admin.updateUserById.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

        expect(await completePhoneChange(PHONE_BORN, PHONE, '123456', 'sms')).toEqual({ ok: true })

        expect(admin.updateUserById).toHaveBeenCalledWith('user-1', { email: PLACEHOLDER, email_confirm: true })
        expect(supabase.writes('user_phones')[0].payload).toMatchObject({ user_id: 'user-1', phone: PHONE })
    })

    it('keeps the old number when the account could not be filed under the new one', async () => {
        stored({})
        admin.updateUserById.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'taken' } })

        expect(await completePhoneChange(PHONE_BORN, PHONE, '123456', 'sms')).toEqual({ ok: false, error: 'taken' })
        expect(supabase.writes('user_phones')).toEqual([])
    })
})

describe('countVerifyAttempt', () => {
    const VERIFY = 'rpc:claim_phone_sign_in_verify'

    it('takes one try out of the number\'s window and the caller\'s, before any code is compared', async () => {
        supabase = fakeSupabase(table => (table === VERIFY ? { data: 'ok' } : undefined))
        expect(await countVerifyAttempt(PHONE, '2a01:cb00:1234:5678:9abc::1')).toBe('ok')
        expect(supabase.chainsOn(VERIFY)[0][0].args).toEqual(['claim_phone_sign_in_verify', { p_phone: PHONE, p_ip: '2a01:cb00:1234:5678::/64', p_phone_max: 5, p_ip_max: 20, p_window_seconds: 900 }])
    })

    it('says too many once either window is full, and unavailable when nothing could be counted', async () => {
        supabase = fakeSupabase(table => (table === VERIFY ? { data: 'phone' } : undefined))
        expect(await countVerifyAttempt(PHONE, IP)).toBe('too_many')
        supabase = fakeSupabase(table => (table === VERIFY ? { data: 'ip' } : undefined))
        expect(await countVerifyAttempt(PHONE, IP)).toBe('too_many')
        supabase = fakeSupabase(table => (table === VERIFY ? { data: null, error: { message: 'down' } } : undefined))
        expect(await countVerifyAttempt(PHONE, IP)).toBe('unavailable')
    })
})
