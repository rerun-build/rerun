import { publishedAccessModeSchema } from '@rerun/contracts'

export const PUBLISHED_ACCESS_MODES = publishedAccessModeSchema.options
export type PublishedAccess = (typeof PUBLISHED_ACCESS_MODES)[number]

export const PUBLISH_POLICIES = ['people', 'anyone', 'never'] as const
export type PublishPolicy = (typeof PUBLISH_POLICIES)[number]

export const DEFAULT_PUBLISH_POLICY: PublishPolicy = 'people'

export function isPublishedAccess(value: unknown): value is PublishedAccess {
    return typeof value === 'string' && (PUBLISHED_ACCESS_MODES as readonly string[]).includes(value)
}

export function isPublishPolicy(value: unknown): value is PublishPolicy {
    return typeof value === 'string' && (PUBLISH_POLICIES as readonly string[]).includes(value)
}

export function effectivePolicy(stored: string | null | undefined): PublishPolicy {
    return isPublishPolicy(stored) ? stored : DEFAULT_PUBLISH_POLICY
}

export type AccessResolution = { access: PublishedAccess; requestedAccess: 'public' | null }

type CoworkerRequest = {
    policy: PublishPolicy
    requested?: PublishedAccess
    current?: { access: PublishedAccess; requestedAccess: 'public' | null }
}

// What a coworker gets when it publishes. A republish that names no access keeps the link as it is:
// a coworker never takes back a public link a person gave. A public link asked under the default
// policy goes live for the members only, and waits for a person to open it wider.
export function resolveCoworkerAccess({ policy, requested, current }: CoworkerRequest): AccessResolution {
    if (!requested) {
        if (current) return current
        return { access: 'workspace', requestedAccess: null }
    }
    if (requested !== 'public') return { access: requested, requestedAccess: null }
    if (policy === 'anyone' || current?.access === 'public') return { access: 'public', requestedAccess: null }

    const fallback = current?.access ?? 'workspace'
    return { access: fallback, requestedAccess: policy === 'people' ? 'public' : null }
}

export function humanMayGrant(policy: PublishPolicy, access: PublishedAccess): boolean {
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

export function inviteAllows(invited: readonly string[], email: string): boolean {
    const address = email.trim().toLowerCase()
    const at = address.lastIndexOf('@')
    if (at <= 0) return false
    return invited.includes(address) || invited.includes(address.slice(at))
}
