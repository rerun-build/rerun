import { AppError } from '@/lib/i18n/action-error'

// Kept apart from access.ts, which the share dialog imports in the browser: its refusals carry codes
// whose English pack has no business in the client bundle.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/
export const MAX_INVITES = 50

// Emails and whole domains (`@client.com`), trimmed, lowercased and deduplicated. A bare
// `client.com` reads as the domain.
export function normalizeInvites(entries: readonly string[]): string[] {
    const invites = new Set<string>()
    for (const raw of entries) {
        const entry = raw.trim().toLowerCase()
        if (!entry) continue
        const invite = EMAIL.test(entry) || entry.startsWith('@') || !entry.includes('.') ? entry : `@${entry}`
        if (!EMAIL.test(invite) && !DOMAIN.test(invite)) throw new AppError('inviteNotEmailOrDomain', { entry: raw.trim() })
        invites.add(invite)
    }
    if (invites.size > MAX_INVITES) throw new AppError('tooManyInvites', { max: MAX_INVITES })
    return [...invites]
}
