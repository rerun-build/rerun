'use server'

import type { User } from '@supabase/supabase-js'

import { AuthorizationError } from '@/app/api/_auth/ownership'
import { backupCodesLeft, generateBackupCodes } from '@/lib/auth/two-step/backup-codes'
import { signInWithBackupCode } from '@/lib/auth/two-step/backup-sign-in'
import { describeUserAgent, type SessionDevice } from '@/lib/auth/two-step/devices'
import { ownFactors, passkeyName } from '@/lib/auth/two-step/factors'
import { hasTwoStep, sessionLevel } from '@/lib/auth/two-step/gate'
import { TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import { PASSKEY_NAME_MAX, type TwoStepRecord } from '@/lib/auth/two-step/record'
import { enrollRecoveryFactor } from '@/lib/auth/two-step/recovery'
import { openSecret } from '@/lib/auth/two-step/seal'
import { readTwoStep, writeTwoStep, writeTwoStepFlag } from '@/lib/auth/two-step/store'
import { failure, failureOf } from '@/lib/i18n/action-error'
import { createClient } from '@/supabase/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getAuthUser, getSigningInAccount } from '@/supabase/session/getServerSession'
import { selectMany } from '@/supabase/supabase-helpers'
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
    const factors = ownFactors(account, record)
    const app = factors.find(factor => factor.factor_type === 'totp')
    const passkeys = factors
        .filter(factor => factor.factor_type === 'webauthn')
        .map(factor => ({ id: factor.id, name: passkeyName(factor, record), createdAt: factor.created_at, lastUsedAt: factor.last_challenged_at ?? null }))
    return {
        app: app ? { id: app.id, createdAt: app.created_at, lastUsedAt: app.last_challenged_at ?? null } : null,
        passkeys,
        backupCodesLeft: factors.length ? backupCodesLeft(record) : null,
        sessions,
    }
}

// `codes` when this load finished a setup that was cut short (its method confirmed, then no flag, no
// recovery factor or no codes): shown once, like at the end of a setup.
export async function getSecurityAction(): Promise<ActionResult<{ security: SecurityState; codes: string[] | null }>> {
    try {
        const account = await requireAccount()
        const record = await readTwoStep(account.id)
        let codes: string[] | null = null
        const unfinished = !hasTwoStep(account.app_metadata) || !record.recovery || !record.codes?.length
        if (unfinished && ownFactors(account, record).length) {
            const client = await createClient()
            if ((await sessionLevel(client)) === 'aal2') codes = await turnOnTwoStep(client, account, record, record.names)
        }
        const [current, sessions] = await Promise.all([codes ? readTwoStep(account.id) : record, readSessions(account.id)])
        return { ok: true, security: securityOf(account, current, sessions), codes }
    } catch (err) {
        return failureOf(err, 'twoStepLoadFailed')
    }
}

function cleanPasskeyName(name: string | undefined): string | null {
    const clean = (name ?? '').trim().replace(/\s+/g, ' ')
    return clean || null
}

// The recovery factor the hub signs in with, kept as long as its secret still opens. A secret sealed
// under a former service key is replaced, along with any factor left under that name.
async function ensureRecovery(client: Awaited<ReturnType<typeof createClient>>, account: User, record: TwoStepRecord): Promise<NonNullable<TwoStepRecord['recovery']>> {
    if (record.recovery) {
        try {
            openSecret(record.recovery.sealedSecret)
            if ((account.factors ?? []).some(factor => factor.id === record.recovery!.factorId && factor.status === 'verified')) return record.recovery
        } catch {
            // Sealed under another key: made again below.
        }
    }
    for (const factor of account.factors ?? []) {
        if (factor.friendly_name === TWO_STEP_RECOVERY_FACTOR_NAME) await client.auth.mfa.unenroll({ factorId: factor.id })
    }
    return enrollRecoveryFactor(client)
}

// Two-step on, from a session at aal2: the hub's recovery factor, the backup codes shown once, the
// flag, and every other session signed out so none of them keeps the account open without it.
async function turnOnTwoStep(client: Awaited<ReturnType<typeof createClient>>, account: User, record: TwoStepRecord, names: TwoStepRecord['names']): Promise<string[]> {
    const recovery = await ensureRecovery(client, account, record)
    const { codes, salt, stored } = generateBackupCodes()
    await writeTwoStep(account.id, { ...record, names, recovery, salt, codes: stored })
    await writeTwoStepFlag(account.id, true)
    await client.auth.signOut({ scope: 'others' })
    await client.auth.refreshSession()
    return codes
}

// Called once a method is set up and verified in the browser, which left the session at aal2. The
// first method turns two-step on. When that fails, the method goes again, so the account is left as
// the error says, without a method the sign-in would not ask for.
export async function finishTwoStepSetupAction(params: { factorId: string; passkeyName?: string }): Promise<ActionResult<{ codes: string[] | null }>> {
    let firstMethod: { client: Awaited<ReturnType<typeof createClient>> } | null = null
    try {
        const { account, client, confirmed } = await requireConfirmedSession()
        if (!confirmed) return failure('twoStepConfirmFirst')
        const { data: fresh } = await client.auth.getUser()
        const current = fresh.user ?? account
        if (!(current.factors ?? []).some(factor => factor.id === params.factorId && factor.status === 'verified')) return failure('twoStepNotYours')

        const record = await readTwoStep(account.id)
        const name = cleanPasskeyName(params.passkeyName)
        const names = name ? { ...record.names, [params.factorId]: name.slice(0, PASSKEY_NAME_MAX) } : record.names
        if (hasTwoStep(current.app_metadata) && record.recovery && record.codes?.length) {
            await writeTwoStep(account.id, { ...record, names })
            return { ok: true, codes: null }
        }

        firstMethod = hasTwoStep(current.app_metadata) ? null : { client }
        return { ok: true, codes: await turnOnTwoStep(client, current, record, names) }
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

export async function renamePasskeyAction(params: { factorId: string; name: string }): Promise<ActionResult> {
    try {
        const account = await requireAccount()
        const name = cleanPasskeyName(params.name)
        if (!name) return failure('passkeyNameRequired')
        if (name.length > PASSKEY_NAME_MAX) return failure('passkeyNameTooLong', { max: PASSKEY_NAME_MAX })
        const record = await readTwoStep(account.id)
        if (!ownFactors(account, record).some(factor => factor.id === params.factorId && factor.factor_type === 'webauthn')) return failure('twoStepNotYours')
        await writeTwoStep(account.id, { ...record, names: { ...record.names, [params.factorId]: name } })
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'passkeySaveFailed')
    }
}

// The last method gone, two-step goes with it: the recovery factor, the codes, the flag.
export async function removeTwoStepMethodAction(params: { factorId: string }): Promise<ActionResult> {
    try {
        const { account, client, confirmed } = await requireConfirmedSession()
        if (!confirmed) return failure('twoStepConfirmFirst')
        const record = await readTwoStep(account.id)
        const own = ownFactors(account, record)
        if (!own.some(factor => factor.id === params.factorId)) return failure('twoStepNotYours')

        const names = Object.fromEntries(Object.entries(record.names ?? {}).filter(([factorId]) => factorId !== params.factorId))
        const last = own.length === 1
        // The recovery factor goes first, while the method still keeps the session at aal2: Supabase
        // removes a verified factor only from such a session.
        if (last) {
            for (const factor of account.factors ?? []) {
                if (factor.friendly_name !== TWO_STEP_RECOVERY_FACTOR_NAME && factor.id !== record.recovery?.factorId) continue
                const { error: recoveryError } = await client.auth.mfa.unenroll({ factorId: factor.id })
                if (recoveryError) throw new Error(recoveryError.message)
            }
        }
        const { error } = await client.auth.mfa.unenroll({ factorId: params.factorId })
        if (error) throw new Error(error.message)

        if (!last) {
            await writeTwoStep(account.id, { ...record, names })
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
        if (!ownFactors(account, record).length) return failure('twoStepConfirmFirst')
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
