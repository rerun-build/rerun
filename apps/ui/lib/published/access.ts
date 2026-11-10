import { PUBLISHED_ACCESS_RELEASED } from '@/lib/features'

export const PUBLISHED_ACCESS_MODES = ['public', 'workspace', 'password', 'invited'] as const
export type PublishedAccess = (typeof PUBLISHED_ACCESS_MODES)[number]

export const PUBLISH_POLICIES = ['people', 'anyone', 'never'] as const
export type PublishPolicy = (typeof PUBLISH_POLICIES)[number]

export const DEFAULT_PUBLISH_POLICY: PublishPolicy = 'people'

// Before the launch, a workspace that never picked a policy publishes like it always did: every
// link public, whoever asks. Picking one in the settings (early access) opts the workspace in.
export type EffectivePolicy = PublishPolicy | 'legacy'

export function isPublishedAccess(value: unknown): value is PublishedAccess {
    return typeof value === 'string' && (PUBLISHED_ACCESS_MODES as readonly string[]).includes(value)
}

export function isPublishPolicy(value: unknown): value is PublishPolicy {
    return typeof value === 'string' && (PUBLISH_POLICIES as readonly string[]).includes(value)
}

export function effectivePolicy(stored: string | null | undefined, released = PUBLISHED_ACCESS_RELEASED): EffectivePolicy {
    if (isPublishPolicy(stored)) return stored
    return released ? DEFAULT_PUBLISH_POLICY : 'legacy'
}

// What the settings show: before the launch, a workspace that picked nothing lets its coworkers
// make links public, so that is the choice ticked, and picking another one is a change to save.
export function shownPolicy(stored: string | null | undefined, released = PUBLISHED_ACCESS_RELEASED): PublishPolicy {
    const policy = effectivePolicy(stored, released)
    return policy === 'legacy' ? 'anyone' : policy
}

export type AccessResolution = { access: PublishedAccess; requestedAccess: 'public' | null }

type CoworkerRequest = {
    policy: EffectivePolicy
    requested?: PublishedAccess
    current?: { access: PublishedAccess; requestedAccess: 'public' | null }
}

// What a coworker gets when it publishes. A republish that names no access keeps the link as it is:
// a coworker never takes back a public link a person gave. A public link asked under the default
// policy goes live for the members only, and waits for a person to open it wider.
export function resolveCoworkerAccess({ policy, requested, current }: CoworkerRequest): AccessResolution {
    if (!requested) {
        if (current) return current
        return { access: policy === 'legacy' ? 'public' : 'workspace', requestedAccess: null }
    }
    if (requested !== 'public') return { access: requested, requestedAccess: null }
    if (policy === 'legacy' || policy === 'anyone' || current?.access === 'public') return { access: 'public', requestedAccess: null }

    const fallback = current?.access ?? 'workspace'
    return { access: fallback, requestedAccess: policy === 'people' ? 'public' : null }
}

export function humanMayGrant(policy: EffectivePolicy, access: PublishedAccess): boolean {
    return access !== 'public' || policy !== 'never'
}

function accessSentence(access: PublishedAccess, invited: readonly string[]): string {
    switch (access) {
        case 'public':
            return 'Anyone with the link can open it.'
        case 'workspace':
            return 'Only the members of this workspace can open it, once signed in.'
        case 'password':
            return 'Anyone with the password can open it. Hand the password over yourself; it is never shown again.'
        case 'invited':
            return `Only ${invited.join(', ')} can open it, after confirming their email with a code.`
    }
}

// What the publish tool tells the coworker. A public link refused outright says so, or the coworker
// makes up a way it could still go public.
export function coworkerAccessMessage(requested: PublishedAccess | undefined, resolution: AccessResolution, invited: readonly string[]): string {
    if (resolution.requestedAccess === 'public') return 'Live for the workspace members only: its policy keeps a coworker from opening a link to everyone. The card of the link under your message asks the user, with a button that makes it public, which any member can click: no setting and no admin needed. Tell them to click it there. Nothing typed in the chat makes it public and publishing again changes nothing, so offer no quick reply and no approval card for it.'
    const sentence = accessSentence(resolution.access, invited)
    if (requested === 'public' && resolution.access !== 'public') return `Public links are turned off for this workspace, so the link was not made public and nobody was asked to. Tell the user plainly; only a workspace admin can turn public links back on, in the workspace settings. ${sentence}`
    return sentence
}

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
        if (!EMAIL.test(invite) && !DOMAIN.test(invite)) throw new Error(`Not an email or a domain: ${raw.trim()}`)
        invites.add(invite)
    }
    if (invites.size > MAX_INVITES) throw new Error(`Invite at most ${MAX_INVITES} people or domains.`)
    return [...invites]
}

export function inviteAllows(invited: readonly string[], email: string): boolean {
    const address = email.trim().toLowerCase()
    const at = address.lastIndexOf('@')
    if (at <= 0) return false
    return invited.includes(address) || invited.includes(address.slice(at))
}
