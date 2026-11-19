import 'server-only'
import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { DESKTOP_AUTH_CODE_TTL_SECONDS } from '@moldwright/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

const CODE_COLUMNS = ['code_hash', 'user_id', 'code_challenge', 'expires_at', 'used_at'] as const

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type DesktopAuthRefusal = 'invalid' | 'expired' | 'unavailable'
export type DesktopAuthRedemption = { ok: true; userId: string } | { ok: false; reason: DesktopAuthRefusal }

function sha256(value: string): Buffer {
    return createHash('sha256').update(value).digest()
}

export function pkceChallenge(verifier: string): string {
    return sha256(verifier).toString('base64url')
}

export function isPkceChallenge(value: unknown): value is string {
    return typeof value === 'string' && CHALLENGE_PATTERN.test(value)
}

function codeHash(code: string): string {
    return sha256(code).toString('hex')
}

export async function mintDesktopAuthCode(userId: string, challenge: string): Promise<string | null> {
    if (!isPkceChallenge(challenge)) return null
    const admin = createServiceRoleClient()
    const code = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + DESKTOP_AUTH_CODE_TTL_SECONDS * 1000).toISOString()
    const { error } = await admin
        .from('desktop_auth_codes')
        .insert<Database['public']['Tables']['desktop_auth_codes']['Insert']>({ code_hash: codeHash(code), user_id: userId, code_challenge: challenge, expires_at: expiresAt })
    if (error) {
        console.error('[desktop-auth] mint failed', error.message)
        return null
    }
    await admin.from('desktop_auth_codes').delete().lt('expires_at', new Date(Date.now() - 3600_000).toISOString())
    return code
}

function challengeMatches(verifier: string, challenge: string): boolean {
    const expected = Buffer.from(challenge)
    const given = Buffer.from(pkceChallenge(verifier))
    return expected.length === given.length && timingSafeEqual(expected, given)
}

export async function redeemDesktopAuthCode(code: string, verifier: string): Promise<DesktopAuthRedemption> {
    if (!CODE_PATTERN.test(code) || !VERIFIER_PATTERN.test(verifier)) return { ok: false, reason: 'invalid' }
    const admin = createServiceRoleClient()
    const hash = codeHash(code)
    const { data: row } = await selectMaybeSingle(admin, 'desktop_auth_codes', CODE_COLUMNS, { code_hash: hash })
    if (!row || row.used_at) return { ok: false, reason: 'invalid' }
    if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: 'expired' }
    if (!challengeMatches(verifier, row.code_challenge)) return { ok: false, reason: 'invalid' }
    const { data: spent, error } = await admin
        .from('desktop_auth_codes')
        .update<Database['public']['Tables']['desktop_auth_codes']['Update']>({ used_at: new Date().toISOString() })
        .eq('code_hash', hash)
        .is('used_at', null)
        .select('user_id')
    if (error) return { ok: false, reason: 'unavailable' }
    if (!spent?.length) return { ok: false, reason: 'invalid' }
    return { ok: true, userId: row.user_id }
}

export async function openDesktopSession(session: SupabaseClient<Database>, userId: string): Promise<boolean> {
    const admin = createServiceRoleClient()
    const { data: account } = await admin.auth.admin.getUserById(userId)
    const email = account.user?.email
    if (!email) return false
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const tokenHash = link.properties?.hashed_token
    if (linkError || !tokenHash) {
        console.error('[desktop-auth] token failed', linkError?.message)
        return false
    }
    const { data, error } = await session.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
    if (error || !data.session) {
        console.error('[desktop-auth] session failed', error?.message)
        return false
    }
    return true
}
