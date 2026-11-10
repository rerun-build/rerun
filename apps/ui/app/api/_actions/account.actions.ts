'use server'

import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import { cookies, headers } from 'next/headers'
import type { User } from '@supabase/supabase-js'

import { AuthorizationError } from '@/app/api/_auth/ownership'
import { accountDeletionBlockers, anonymizeAccount } from '@/app/api/_services/account-deletion.service'
import { syncStripeCustomerEmail } from '@rerun/cloud/billing.server'
import { phoneOwnerId } from '@rerun/cloud/phone.server'
import { DELETE_ACCOUNT_CONFIRMATION, type AccountDeletionBlocker } from '@/lib/auth/account-deletion'
import { OAUTH_PROVIDERS, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { isPlaceholderEmail, realEmail } from '@/lib/auth/placeholder-email'
import { PROFILE_NAME_MAX } from '@/lib/auth/user-profile'
import { normalizeEmail } from '@/lib/email'
import { uploadPublicImage } from '@/lib/images/upload'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { Database } from '@/app/api/database.types'
import { isStableLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, PSEUDO_LOCALE, type Locale } from '@rerun/i18n'
import { failure, failureOf } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'

const USER_AVATARS_BUCKET = 'user-avatars'
const AVATAR_MAX_SIZE = 512
const AVATAR_MAX_BYTES = 8 * 1024 * 1024

async function requireAccount(): Promise<User> {
    const { session, isAnonymous } = await getServerSession()
    if (!session || isAnonymous) throw new AuthorizationError('signInToEditAccount')
    return session
}

// Supabase merges the keys it is handed into the stored metadata, so only what changes is sent.
async function writeChosenProfile(account: User, chosen: { full_name?: string; avatar_url?: string }, userMetadata?: Record<string, unknown>) {
    const { error } = await createServiceRoleClient().auth.admin.updateUserById(account.id, {
        app_metadata: chosen,
        ...(userMetadata ? { user_metadata: userMetadata } : {}),
    })
    if (error) throw new Error(error.message)
}

export async function updateMyNameAction(params: { name: string }): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        const name = params.name.trim().replace(/\s+/g, ' ')
        if (!name) return failure('nameRequired')
        if (name.length > PROFILE_NAME_MAX) return failure('keepItUnder', { max: PROFILE_NAME_MAX })

        // The greeting of an email and the foreman read the first name from `user_metadata`.
        await writeChosenProfile(account, { full_name: name }, { full_name: name, first_name: name.split(' ')[0] })
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'saveNameFailed')
    }
}

// Saved on the account for the emails and notifications it receives, and mirrored in a cookie so
// this device reads it without a query. The cookie sits on `.rerun.build`, where the landing reads it
// too. `null` goes back to following the browser.
export async function updateMyLocaleAction(params: { locale: Locale | typeof PSEUDO_LOCALE | null }): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        const { locale } = params
        const pseudo = locale === PSEUDO_LOCALE && process.env.NODE_ENV !== 'production'
        if (locale !== null && !pseudo && !isStableLocale(locale)) return failure('unknownLanguage')

        if (!pseudo) {
            const service = createServiceRoleClient()
            const { error } = await service.from('users').update<Database['public']['Tables']['users']['Update']>({ locale }).eq('id', account.id)
            if (error) throw new Error(error.message)
            // The sign-in code emails are Supabase's own templates, which can only read the metadata.
            const { error: metadataError } = await service.auth.admin.updateUserById(account.id, { user_metadata: { locale } })
            if (metadataError) throw new Error(metadataError.message)
        }

        const cookieStore = await cookies()
        const host = ((await headers()).get('host') ?? '').split(':')[0]
        const domain = host.endsWith('rerun.build') ? '.rerun.build' : undefined
        if (locale === null) cookieStore.set(LOCALE_COOKIE, '', { path: '/', maxAge: 0, domain })
        else cookieStore.set(LOCALE_COOKIE, locale, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: 'lax', domain })
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'changeLanguageFailed')
    }
}

// The URL is written here and nowhere else: it ends up in an <img> on a teammate's screen, so
// nothing the browser sends may reach it verbatim.
export async function uploadMyAvatarAction(formData: FormData): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        const file = formData.get('file')
        if (!(file instanceof File)) return failure('noFileProvided')
        if (!file.type.startsWith('image/')) return failure('chooseImage')
        if (file.size > AVATAR_MAX_BYTES) return failure('imageTooLarge', { max: AVATAR_MAX_BYTES / (1024 * 1024) })

        const url = await uploadPublicImage(createServiceRoleClient(), await file.arrayBuffer(), USER_AVATARS_BUCKET, account.id, { maxSize: AVATAR_MAX_SIZE })
        await writeChosenProfile(account, { avatar_url: url })
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'uploadPhotoFailed')
    }
}

export async function removeMyAvatarAction(): Promise<ActionResult> {
    try {
        await writeChosenProfile(await requireAccount(), { avatar_url: '' })
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'removePhotoFailed')
    }
}

export type ConnectedIdentity = { email: string | null; canDisconnect: boolean }

export type SignInMethods = {
    email: string | null
    oauth: Record<OAuthProvider, ConnectedIdentity | null>
    // `signsInHere` is false when an older account verified the same number: it is the one the
    // number opens.
    phone: { number: string; signsInHere: boolean } | null
}

export async function getSignInMethodsAction(): Promise<ActionResult<{ methods: SignInMethods }>> {
    try {
        const account = await requireAccount()
        const admin = createServiceRoleClient()

        const identities = account.identities ?? []
        const connected = (provider: OAuthProvider): ConnectedIdentity | null => {
            const identity = identities.find(candidate => candidate.provider === provider)
            if (!identity) return null
            const email = identity.identity_data?.email
            // Supabase refuses to remove the last identity of an account.
            return { email: typeof email === 'string' ? email : null, canDisconnect: identities.length > 1 }
        }

        const { data: row } = await selectMaybeSingle(admin, 'user_phones', ['phone', 'verified_at'] as const, { user_id: account.id })
        const verifiedPhone = row?.verified_at ? row.phone : null
        const owner = verifiedPhone ? await phoneOwnerId(admin, verifiedPhone) : null

        return {
            ok: true,
            methods: {
                email: realEmail(account.email),
                oauth: Object.fromEntries(OAUTH_PROVIDERS.map(provider => [provider, connected(provider)])) as SignInMethods['oauth'],
                phone: verifiedPhone ? { number: parsePhoneNumberFromString(verifiedPhone)?.formatInternational() ?? verifiedPhone, signsInHere: owner?.userId === account.id } : null,
            },
        }
    } catch (err) {
        return failureOf(err, 'loadSignInMethodsFailed')
    }
}

// `a.mail.example.com` is refused by a block on any of its parents, as at signup.
function domainAndParents(email: string): string[] {
    const labels = (email.split('@')[1] ?? '').split('.')
    return labels.map((_, index) => labels.slice(index).join('.')).filter(Boolean)
}

// What signing up checks on an address, asked again before the account moves to a new one: the
// `before_user_created` hook only runs when an account is born.
export async function prepareEmailChangeAction(params: { email: string }): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        const email = normalizeEmail(params.email)
        if (isPlaceholderEmail(email)) return failure('invalidEmail')
        if (email === account.email?.toLowerCase()) return failure('sameEmail')

        const admin = createServiceRoleClient()
        const { data: blocked } = await selectMany(admin, 'blocked_email_domains', ['domain'] as const, { domain: domainAndParents(email) }, undefined, 1)
        if (blocked?.length) return failure('emailDomainBlocked')

        const { data: taken, error } = await admin.rpc('check_email_exists', { email })
        if (error) throw new Error(error.message)
        if (taken) return failure('emailTaken')
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'checkEmailFailed')
    }
}

// Called once the new address is confirmed. Best effort: the account has already moved.
export async function syncAccountEmailAction(): Promise<void> {
    try {
        const account = await requireAccount()
        const email = realEmail(account.email)
        if (email) await syncStripeCustomerEmail(account.id, email)
    } catch (err) {
        console.error('[account] email sync failed', err instanceof Error ? err.message : err)
    }
}

export async function getAccountDeletionStatusAction(): Promise<ActionResult<{ blockers: AccountDeletionBlocker[] }>> {
    try {
        const account = await requireAccount()
        return { ok: true, blockers: await accountDeletionBlockers(createServiceRoleClient(), account.id) }
    } catch (err) {
        return failureOf(err, 'checkAccountFailed')
    }
}

export async function deleteMyAccountAction(params: { confirmation: string }): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        if (params.confirmation.trim() !== DELETE_ACCOUNT_CONFIRMATION) return failure('typeToConfirm', { word: DELETE_ACCOUNT_CONFIRMATION })

        const result = await anonymizeAccount(createServiceRoleClient(), account.id)
        if (!result.ok) return failure('cancelSubscriptionsFirst', { names: result.blockers.map(blocker => blocker.name).join(', ') })
        return { ok: true }
    } catch (err) {
        console.error('[account] deletion failed', err instanceof Error ? err.message : err)
        return failureOf(err, 'deleteAccountFailed')
    }
}
