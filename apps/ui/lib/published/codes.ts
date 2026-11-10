import 'server-only'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { Database } from '@/app/api/database.types'
import { sendPublishedAccessCodeEmail } from '@rerun/cloud/email'
import { callerRateKey } from '@/lib/auth/caller-ip'
import { inviteAllows } from '@/lib/published/access'
import { workspaceLocale } from '@/lib/i18n/recipient-locale'
import type { PublishedEntry } from '@/lib/published/gate'
import { loadWorkspaceBrand } from '@/lib/published/gate'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import { emailTranslator } from '@rerun/emails/i18n'

const CODE_TTL_MINUTES = 10
const MAX_CODE_ATTEMPTS = 5
const CODE_DIGITS = 6

// The answer to "send me a code" is the same whether the address is invited or not, so the gate
// never tells who is on the list. What stops a script from mailing an invitee all day, or from
// guessing codes, is these windows.
const SEND_WINDOW_SECONDS = 10 * 60
const SENDS_PER_ADDRESS = 3
const SENDS_PER_CALLER = 20
const VERIFY_WINDOW_SECONDS = 15 * 60
const VERIFIES_PER_CALLER = 20
const PASSWORD_WINDOW_SECONDS = 15 * 60
const PASSWORD_TRIES_PER_CALLER = 10
const PASSWORD_TRIES_PER_LINK = 100

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizedEmail(raw: string | null | undefined): string | null {
    const email = (raw ?? '').trim().toLowerCase()
    return EMAIL.test(email) && email.length <= 254 ? email : null
}

function secret(): string {
    const value = process.env.PUBLISHED_ACCESS_SECRET
    if (!value) throw new Error('PUBLISHED_ACCESS_SECRET is not configured on this server.')
    return value
}

function codeHash(fileId: string, email: string, code: string): string {
    return createHmac('sha256', secret()).update(`${fileId}:${email}:${code}`).digest('base64url')
}

async function claim(scopes: string[], max: number, windowSeconds: number): Promise<boolean> {
    const { data, error } = await createServiceRoleClient().rpc('claim_published_gate_attempt', { p_scopes: scopes, p_max: max, p_window_seconds: windowSeconds })
    if (error) throw new Error(`Gate limit check failed: ${error.message}`)
    return data === true
}

export async function claimPasswordTry(slug: string, ip: string): Promise<boolean> {
    const caller = callerRateKey(ip)
    const [perCaller, perLink] = await Promise.all([
        claim([`password:${slug}:${caller}`], PASSWORD_TRIES_PER_CALLER, PASSWORD_WINDOW_SECONDS),
        claim([`password:${slug}`], PASSWORD_TRIES_PER_LINK, PASSWORD_WINDOW_SECONDS),
    ])
    return perCaller && perLink
}

export type SendOutcome = 'sent' | 'silent' | 'limited'

export async function sendAccessCode(entry: PublishedEntry, email: string, ip: string): Promise<SendOutcome> {
    const caller = callerRateKey(ip)
    const [perAddress, perCaller] = await Promise.all([
        claim([`code-send:${entry.slug}:${email}`], SENDS_PER_ADDRESS, SEND_WINDOW_SECONDS),
        claim([`code-send:${caller}`], SENDS_PER_CALLER, SEND_WINDOW_SECONDS),
    ])
    if (!perAddress || !perCaller) return 'limited'
    if (entry.access !== 'invited' || !inviteAllows(entry.invited, email)) return 'silent'

    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0')
    const supabase = createServiceRoleClient()
    await supabase.from('published_access_codes').delete().eq('published_file_id', entry.id).eq('email', email)
    const { error } = await supabase.from('published_access_codes').insert<Database['public']['Tables']['published_access_codes']['Insert']>({
        published_file_id: entry.id,
        email,
        code_hash: codeHash(entry.id, email, code),
        expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    })
    if (error) throw new Error(`Failed to store the access code: ${error.message}`)

    const brand = await loadWorkspaceBrand(entry.workspace_id)
    const locale = await workspaceLocale(supabase, entry.workspace_id)
    const pageTitle = entry.title ?? emailTranslator(locale)('publishedAccessCode.untitledPage')
    await sendPublishedAccessCodeEmail({ to: email, code, workspaceName: brand.name, pageTitle, expiresInMinutes: CODE_TTL_MINUTES, locale })
    return 'sent'
}

export type VerifyOutcome = 'ok' | 'wrong' | 'limited'

export async function verifyAccessCode(entry: PublishedEntry, email: string, code: string, ip: string): Promise<VerifyOutcome> {
    if (!(await claim([`code-verify:${entry.slug}:${callerRateKey(ip)}`], VERIFIES_PER_CALLER, VERIFY_WINDOW_SECONDS))) return 'limited'
    if (entry.access !== 'invited' || !inviteAllows(entry.invited, email)) return 'wrong'

    const supabase = createServiceRoleClient()
    const { data: rows } = await selectMany(supabase, 'published_access_codes', ['id', 'code_hash', 'attempts', 'expires_at'] as const, { published_file_id: entry.id, email })
    const row = rows?.[0]
    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) return 'wrong'

    const expected = Buffer.from(row.code_hash)
    const given = Buffer.from(codeHash(entry.id, email, code.replace(/\D/g, '')))
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        await supabase
            .from('published_access_codes')
            .update<Database['public']['Tables']['published_access_codes']['Update']>({ attempts: row.attempts + 1 })
            .eq('id', row.id)
        return 'wrong'
    }

    await supabase.from('published_access_codes').delete().eq('id', row.id)
    return 'ok'
}
