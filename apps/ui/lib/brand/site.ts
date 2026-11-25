import { organizationOfHost } from '@rerun/cloud/organizations.server'
import type { Brand } from '@rerun/contracts'
import { classifyHost } from './host'

// Whose app answers on a host.
export type HostSite =
    | { kind: 'rerun' }
    | { kind: 'published'; slug: string }
    | { kind: 'organization'; brand: Brand; organizationId: string; suspended: boolean }
    | { kind: 'unknown' }

// A read that failed throws: an organization's clients are never shown Rerun instead, nor a stranger's
// domain the app.
export async function hostSite(host: string | null): Promise<HostSite> {
    const address = classifyHost(host)
    if (address.kind !== 'organization' && address.kind !== 'domain') return address
    const organization = await organizationOfHost(address)
    return organization ? { kind: 'organization', ...organization } : { kind: 'unknown' }
}

// An address the app may send a browser back to: one an organization is being served on right now.
export async function organizationOfOrigin(origin: string): Promise<{ organizationId: string } | null> {
    if (!URL.canParse(origin) || new URL(origin).origin !== origin) return null
    const site = await hostSite(new URL(origin).host)
    return site.kind === 'organization' && !site.suspended ? { organizationId: site.organizationId } : null
}
