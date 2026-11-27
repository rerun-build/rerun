'use server'

import type { User } from '@supabase/supabase-js'

import { AuthorizationError } from '@/app/api/_auth/ownership'
import { backupCodesLeft, generateBackupCodes } from '@/lib/auth/two-step/backup-codes'
import { signInWithBackupCode } from '@/lib/auth/two-step/backup-sign-in'
import { describeUserAgent, type SessionDevice } from '@/lib/auth/two-step/devices'
import { methodCount, ownMethods } from '@/lib/auth/two-step/factors'
import { asksSecondStep, hasTwoStep, sessionLevel } from '@/lib/auth/two-step/gate'
import { cleanPasskeyName, passkeyRegistrationOptions, passkeySignInOptions, signInWithPasskey, verifyPasskeyRegistration } from '@/lib/auth/two-step/passkeys'
import { getBrand } from '@/lib/brand/server'
import { isWhiteLabel, TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import { PASSKEY_MAX, PASSKEY_NAME_MAX, type StoredPasskey, type TwoStepRecord } from '@/lib/auth/two-step/record'
import { enrollRecoveryFactor } from '@/lib/auth/two-step/recovery'
import { opensSecret } from '@/lib/auth/two-step/seal'
import { readTwoStep, writeTwoStep, writeTwoStepFlag } from '@/lib/auth/two-step/store'
import { failure, failureOf, type ActionFailure } from '@/lib/i18n/action-error'
import { createClient } from '@/supabase/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getAuthUser, getSigningInAccount } from '@/supabase/session/getServerSession'
import { selectMany } from '@/supabase/supabase-helpers'
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import type { ActionResult } from './space.actions'

export type SecurityMethod = { id: string; createdAt: string; lastUsedAt: string | null }
export type SecurityPasskey = SecurityMethod & { name: string }
export type SecuritySession = { id: string; device: SessionDevice; signedInAt: string | null; lastActiveAt: string | null; activeNow: boolean; current: boolean }
export type SecurityState = { app: SecurityMethod | null; passkeys: SecurityPasskey[]; backupCodesLeft: number | null; sessions: SecuritySession[] }

async function requireAccount(): Promise<User> {
    const account = await getAuthUser()
    if (!account || account.is_anonymous) throw new AuthorizationError('signInToEditAccount')
    return account
}

// Changing a method asks for a session that went through one: Supabase refuses the rest anyway.
async function requireConfirmedSession() {
    const account = await requireAccount()
    const client = await createClient()
    if ((await sessionLevel(client)) !== 'aal2') return { account, client, confirmed: false as const }
    return { account, client, confirmed: true as const }
}

// `auth.sessions` keeps its times without a zone, in UTC.
function utc(value: string | null): string | null {
    if (!value) return null
    return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
}

// A session refreshed this recently is in use.
const ACTIVE_NOW_MS = 5 * 60 * 1000

async function currentSessionId(): Promise<string | null> {
    const { data } = await (await createClient()).auth.getClaims()
    const sessionId = data?.claims.session_id
    return typeof sessionId === 'string' ? sessionId : null
}

async function readSessions(userId: string): Promise<SecuritySession[]> {
    const [{ data: rows }, current] = await Promise.all([
        selectMany(createServiceRoleClient(), 'auth_sessions', ['id', 'created_at', 'updated_at', 'refreshed_at', 'user_agent', 'not_after'] as const, { user_id: userId }, { column: 'updated_at', ascending: false }),
        currentSessionId(),
    ])
    const now = Date.now()
    return (rows ?? [])
        .filter(row => row.id && (!row.not_after || Date.parse(utc(row.not_after)!) > now))
        .map(row => {
            const lastActiveAt = utc(row.refreshed_at ?? row.updated_at ?? row.created_at)
            return {
                id: row.id!,
                device: describeUserAgent(row.user_agent),
                signedInAt: utc(row.created_at),
                lastActiveAt,
                activeNow: row.id === current || (lastActiveAt !== null && now - Date.parse(lastActiveAt) < ACTIVE_NOW_MS),
                current: row.id === current,
            }
        })
        .sort((a, b) => Number(b.current) - Number(a.current))
}

function securityOf(account: User, record: TwoStepRecord, sessions: SecuritySession[]): SecurityState {
    const methods = ownMethods(account, record)
    const { app } = methods
    return {
        app: app ? { id: app.id, createdAt: app.created_at, lastUsedAt: app.last_challenged_at ?? null } : null,
        passkeys: methods.passkeys.map(passkey => ({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt })),
        backupCodesLeft: methodCount(methods) ? backupCodesLeft(record) : null,
        sessions,
    }
}

// `codes` when this load finished a setup that was cut short (its method confirmed, then no flag, no
// recovery factor or no codes): shown once, like at the end of a setup. A recovery factor whose secret
// no longer opens (sealed under a key this server lost) is made again here, the backup codes kept.
export async function getSecurityAction(): Promise<ActionResult<{ security: SecurityState; codes: string[] | null }>> {
    try {
        const account = await requireAccount()
        const record = await readTwoStep(account.id)
        let current = record
        let codes: string[] | null = null
        const unfinished = !hasTwoStep(account.app_metadata) || !record.recovery || !record.codes?.length
        const sealedAway = !!record.recovery && !opensSecret(record.recovery.sealedSecret)
        if ((unfinished || sealedAway) && methodCount(ownMethods(account, record))) {
            const client = await createClient()
            if ((await sessionLevel(client)) === 'aal2') {
                if (unfinished) {
                    codes = await turnOnTwoStep(client, account, record)
                    current = await readTwoStep(account.id)
                } else {
                    current = { ...record, recovery: await ensureRecovery(client, account, record) }
                    await writeTwoStep(account.id, current)
                }
            }
        }
        const sessions = await readSessions(account.id)
        return { ok: true, security: securityOf(account, current, sessions), codes }
    } catch (err) {
        return failureOf(err, 'twoStepLoadFailed')
    }
}

// The recovery factor the hub signs in with, kept as long as its secret still opens. A secret sealed
// under a key this server no longer has is replaced, along with any factor left under that name.
async function ensureRecovery(client: Awaited<ReturnType<typeof createClient>>, account: User, record: TwoStepRecord): Promise<NonNullable<TwoStepRecord['recovery']>> {
    const kept = record.recovery
    if (kept && opensSecret(kept.sealedSecret) && (account.factors ?? []).some(factor => factor.id === kept.factorId && factor.status === 'verified')) return kept
    for (const factor of account.factors ?? []) {
        if (factor.friendly_name === TWO_STEP_RECOVERY_FACTOR_NAME) await client.auth.mfa.unenroll({ factorId: factor.id })
    }
    return enrollRecoveryFactor(client)
}

// Two-step on: the hub's recovery factor (verifying it leaves the session at aal2, which a first
// passkey alone cannot), the backup codes shown once, the flag, and every other session signed out so
// none of them keeps the account open without it.
async function turnOnTwoStep(client: Awaited<ReturnType<typeof createClient>>, account: User, record: TwoStepRecord): Promise<string[]> {
    const recovery = await ensureRecovery(client, account, record)
    const { codes, salt, stored } = generateBackupCodes()
    await writeTwoStep(account.id, { ...record, recovery, salt, codes: stored })
    await writeTwoStepFlag(account.id, true)
    await client.auth.signOut({ scope: 'others' })
    await client.auth.refreshSession()
    return codes
}

// Called once the authenticator app is set up and verified in the browser, which left the session at
// aal2. The first method turns two-step on. When that fails, the method goes again, so the account is
// left as the error says, without a method the sign-in would not ask for.
export async function finishTwoStepSetupAction(params: { factorId: string }): Promise<ActionResult<{ codes: string[] | null }>> {
    let firstMethod: { client: Awaited<ReturnType<typeof createClient>> } | null = null
    try {
        const { account, client, confirmed } = await requireConfirmedSession()
        if (!confirmed) return failure('twoStepConfirmFirst')
        const { data: fresh } = await client.auth.getUser()
        const current = fresh.user ?? account
        if (!(current.factors ?? []).some(factor => factor.id === params.factorId && factor.status === 'verified')) return failure('twoStepNotYours')

        const record = await readTwoStep(account.id)
        if (hasTwoStep(current.app_metadata) && record.recovery && record.codes?.length) return { ok: true, codes: null }

        firstMethod = hasTwoStep(current.app_metadata) ? null : { client }
        return { ok: true, codes: await turnOnTwoStep(client, current, record) }
    } catch (err) {
        if (firstMethod) await undoFirstMethod(firstMethod.client, params.factorId)
        return failureOf(err, 'twoStepSetupFailed')
    }
}

// The recovery factor first, while the method still keeps the session at aal2.
async function undoFirstMethod(client: Awaited<ReturnType<typeof createClient>>, factorId: string) {
    const { data } = await client.auth.mfa.listFactors()
    for (const factor of data?.all ?? []) {
        if (factor.friendly_name === TWO_STEP_RECOVERY_FACTOR_NAME) await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
    }
    await client.auth.mfa.unenroll({ factorId }).catch(() => {})
}

// A passkey is set up on the hub's own address only. On an account with two-step already on, from a
// session that went through it; on one without, it is the first method and turns two-step on.
type PasskeySetup = { refusal: ActionFailure } | { refusal: null; account: User; client: Awaited<ReturnType<typeof createClient>>; record: TwoStepRecord }

async function requirePasskeySetup(): Promise<PasskeySetup> {
    const account = await requireAccount()
    if (isWhiteLabel(await getBrand())) return { refusal: failure('twoStepSetupFailed') }
    const client = await createClient()
    if (asksSecondStep(account) && (await sessionLevel(client)) !== 'aal2') return { refusal: failure('twoStepConfirmFirst') }
    const record = await readTwoStep(account.id)
    if ((record.passkeys?.length ?? 0) >= PASSKEY_MAX) return { refusal: failure('passkeyLimit', { max: PASSKEY_MAX }) }
    return { refusal: null, account, client, record }
}

export async function startPasskeySetupAction(): Promise<ActionResult<{ options: PublicKeyCredentialCreationOptionsJSON }>> {
    try {
        const setup = await requirePasskeySetup()
        if (setup.refusal) return setup.refusal
        return { ok: true, options: await passkeyRegistrationOptions(setup.account, setup.record) }
    } catch (err) {
        return failureOf(err, 'twoStepSetupFailed')
    }
}

// The browser's answer to the setup above. The first method also turns two-step on, and when that
// fails the passkey goes again, so the account is left as the error says.
export async function finishPasskeySetupAction(params: { response: RegistrationResponseJSON; name: string }): Promise<ActionResult<{ passkeyId: string; codes: string[] | null }>> {
    let firstMethod: { client: Awaited<ReturnType<typeof createClient>>; userId: string; passkeyId: string } | null = null
    try {
        const setup = await requirePasskeySetup()
        if (setup.refusal) return setup.refusal
        const { account, client } = setup
        const verified = await verifyPasskeyRegistration(account.id, params.response, cleanPasskeyName(params.name) ?? 'Passkey')
        if (!verified) return failure('twoStepSetupFailed')
        const record: TwoStepRecord = { ...verified.record, passkeys: [...(verified.record.passkeys ?? []), verified.passkey] }
        if (hasTwoStep(account.app_metadata) && record.recovery && record.codes?.length) {
            await writeTwoStep(account.id, record)
            return { ok: true, passkeyId: verified.passkey.id, codes: null }
        }

        firstMethod = hasTwoStep(account.app_metadata) ? null : { client, userId: account.id, passkeyId: verified.passkey.id }
        return { ok: true, passkeyId: verified.passkey.id, codes: await turnOnTwoStep(client, account, record) }
    } catch (err) {
        if (firstMethod) await undoFirstPasskey(firstMethod.client, firstMethod.userId, firstMethod.passkeyId)
        return failureOf(err, 'twoStepSetupFailed')
    }
}

async function undoFirstPasskey(client: Awaited<ReturnType<typeof createClient>>, userId: string, passkeyId: string) {
    const { data } = await client.auth.mfa.listFactors()
    for (const factor of data?.all ?? []) {
        if (factor.friendly_name === TWO_STEP_RECOVERY_FACTOR_NAME) await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
    }
    const record = await readTwoStep(userId)
    await writeTwoStep(userId, { ...record, passkeys: (record.passkeys ?? []).filter(passkey => passkey.id !== passkeyId) }).catch(() => {})
    await writeTwoStepFlag(userId, false).catch(() => {})
}

export async function renamePasskeyAction(params: { passkeyId: string; name: string }): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        const clean = (params.name ?? '').trim().replace(/\s+/g, ' ')
        if (!clean) return failure('passkeyNameRequired')
        if (clean.length > PASSKEY_NAME_MAX) return failure('passkeyNameTooLong', { max: PASSKEY_NAME_MAX })
        const record = await readTwoStep(account.id)
        if (!(record.passkeys ?? []).some(passkey => passkey.id === params.passkeyId)) return failure('twoStepNotYours')
        const rename = (passkey: StoredPasskey) => (passkey.id === params.passkeyId ? { ...passkey, name: clean } : passkey)
        await writeTwoStep(account.id, { ...record, passkeys: record.passkeys!.map(rename) })
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'passkeySaveFailed')
    }
}

// The last method gone, two-step goes with it: the recovery factor, the codes, the flag. `methodId` is
// the authenticator app's factor or one of the hub's passkeys.
export async function removeTwoStepMethodAction(params: { methodId: string }): Promise<ActionResult> {
    try {
        const { account, client, confirmed } = await requireConfirmedSession()
        if (!confirmed) return failure('twoStepConfirmFirst')
        const record = await readTwoStep(account.id)
        const methods = ownMethods(account, record)
        const isApp = methods.app?.id === params.methodId
        if (!isApp && !methods.passkeys.some(passkey => passkey.id === params.methodId)) return failure('twoStepNotYours')

        const last = methodCount(methods) === 1
        // The recovery factor goes first, while the method still keeps the session at aal2: Supabase
        // removes a verified factor only from such a session.
        if (last) {
            for (const factor of account.factors ?? []) {
                if (factor.friendly_name !== TWO_STEP_RECOVERY_FACTOR_NAME && factor.id !== record.recovery?.factorId) continue
                const { error: recoveryError } = await client.auth.mfa.unenroll({ factorId: factor.id })
                if (recoveryError) throw new Error(recoveryError.message)
            }
        }
        if (isApp) {
            const { error } = await client.auth.mfa.unenroll({ factorId: params.methodId })
            if (error) throw new Error(error.message)
        }

        if (!last) {
            if (!isApp) await writeTwoStep(account.id, { ...record, passkeys: methods.passkeys.filter(passkey => passkey.id !== params.methodId) })
            return { ok: true }
        }
        await writeTwoStep(account.id, null)
        await writeTwoStepFlag(account.id, false)
        await client.auth.refreshSession()
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'twoStepRemoveFailed')
    }
}

export async function newBackupCodesAction(): Promise<ActionResult<{ codes: string[] }>> {
    try {
        const { account, client, confirmed } = await requireConfirmedSession()
        if (!confirmed) return failure('twoStepConfirmFirst')
        const record = await readTwoStep(account.id)
        if (!methodCount(ownMethods(account, record))) return failure('twoStepConfirmFirst')
        const recovery = await ensureRecovery(client, account, record)
        const { codes, salt, stored } = generateBackupCodes()
        await writeTwoStep(account.id, { ...record, recovery, salt, codes: stored })
        return { ok: true, codes }
    } catch (err) {
        return failureOf(err, 'twoStepCodesFailed')
    }
}

// At sign-in, the second step with a backup code: spent, then the session is raised by the hub.
export async function spendBackupCodeAction(params: { code: string }): Promise<ActionResult> {
    try {
        const signingIn = await getSigningInAccount()
        if (!signingIn || signingIn.user.is_anonymous) throw new AuthorizationError('signInToEditAccount')
        const result = await signInWithBackupCode(await createClient(), signingIn.user.id, params.code)
        if (!result.ok) return failure(result.reason === 'too_many' ? 'backupCodeTooManyTries' : 'backupCodeWrong')
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'backupCodeWrong')
    }
}

async function requireSigningIn() {
    const signingIn = await getSigningInAccount()
    if (!signingIn || signingIn.user.is_anonymous) throw new AuthorizationError('signInToEditAccount')
    return signingIn.user
}

// At sign-in, the second step with a passkey: every passkey of the account is offered.
export async function startPasskeySignInAction(): Promise<ActionResult<{ options: PublicKeyCredentialRequestOptionsJSON }>> {
    try {
        const user = await requireSigningIn()
        if (isWhiteLabel(await getBrand())) return failure('passkeyRefused')
        const options = await passkeySignInOptions(user.id)
        if (!options) return failure('passkeyRefused')
        return { ok: true, options }
    } catch (err) {
        return failureOf(err, 'passkeyRefused')
    }
}

export async function finishPasskeySignInAction(params: { response: AuthenticationResponseJSON }): Promise<ActionResult> {
    try {
        const user = await requireSigningIn()
        const result = await signInWithPasskey(await createClient(), user.id, params.response)
        if (!result.ok) return failure(result.reason === 'too_many' ? 'backupCodeTooManyTries' : 'passkeyRefused')
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'passkeyRefused')
    }
}

export async function signOutSessionAction(params: { sessionId: string }): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        if (params.sessionId === (await currentSessionId())) return failure('signOutSessionFailed')
        const { error } = await createServiceRoleClient().from('auth_sessions').delete().eq('id', params.sessionId).eq('user_id', account.id)
        if (error) throw new Error(error.message)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'signOutSessionFailed')
    }
}

export async function signOutOtherSessionsAction(): Promise<ActionResult> {
    try {
        await requireAccount()
        const { error } = await (await createClient()).auth.signOut({ scope: 'others' })
        if (error) throw new Error(error.message)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'signOutSessionFailed')
    }
}
