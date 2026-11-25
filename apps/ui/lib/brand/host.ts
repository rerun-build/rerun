import { APP_URL } from '@/lib/app-url'
import { extractPublishedSlug, publishHostname } from '@/lib/published/host'
import { hostnameOf, isInternalHostname } from '@/lib/request-host'
import { organizationRootDomain } from './root-domain'

export type HostKind =
    // Rerun's own app, whatever the host on an install without organizations.
    | { kind: 'rerun' }
    | { kind: 'published'; slug: string }
    // May be an organization's: its default address, or a domain of its own.
    | { kind: 'organization'; slug: string }
    | { kind: 'domain'; hostname: string }
    | { kind: 'unknown' }

const RERUN: HostKind = { kind: 'rerun' }
const UNKNOWN: HostKind = { kind: 'unknown' }

// Every deployment of ours: production, staging, the test slots.
const RERUN_DOMAIN = 'rerun.build'
const ORGANIZATION_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/

const isUnder = (hostname: string, domain: string): boolean => hostname === domain || hostname.endsWith(`.${domain}`)

export function canonicalHostname(): string {
    return new URL(APP_URL).hostname
}

export function classifyHost(host: string | null): HostKind {
    const published = extractPublishedSlug(host)
    if (published) return { kind: 'published', slug: published }

    const root = organizationRootDomain()
    if (!root || !host) return RERUN
    const hostname = hostnameOf(host)
    if (hostname === canonicalHostname() || isUnder(hostname, RERUN_DOMAIN) || isInternalHostname(hostname)) return RERUN
    if (isUnder(hostname, root)) {
        const label = hostname.slice(0, -(root.length + 1))
        return ORGANIZATION_LABEL.test(label) ? { kind: 'organization', slug: label } : UNKNOWN
    }
    const publish = publishHostname()
    if (publish && isUnder(hostname, publish)) return UNKNOWN
    return { kind: 'domain', hostname }
}

// The scheme and the port of the app itself: https on none in production, the dev server's locally.
function originOf(hostname: string): string {
    const { protocol, port } = new URL(APP_URL)
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`
}

export function organizationDefaultHostname(slug: string): string | null {
    const root = organizationRootDomain()
    return root && `${slug}.${root}`
}

// The address that outlives a domain of their own.
export function organizationDefaultOrigin(slug: string): string | null {
    const hostname = organizationDefaultHostname(slug)
    return hostname && originOf(hostname)
}

// Where an organization's people open the app: their own domain once it is served, else the default
// address. Null where organizations have no address.
export function organizationOrigin(slug: string, hostname: string | null): string | null {
    const fallback = organizationDefaultOrigin(slug)
    return fallback && (hostname ? originOf(hostname) : fallback)
}

// The name a custom domain points at.
export function edgeHostname(): string | null {
    const root = organizationRootDomain()
    return root && `edge.${root}`
}
