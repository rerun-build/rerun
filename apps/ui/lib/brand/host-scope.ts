import type { HostScope } from '@/lib/workspace/host-workspace'
import { requestSite } from './request-site'
import { organizationRootDomain } from './root-domain'

// Never the id of an organization: a host that is nobody's opens nothing.
const NOBODY: HostScope = { organizationId: 'nobody' }

// Null where organizations have no address: nothing depends on the host.
export async function requestHostScope(): Promise<HostScope | null> {
    if (!organizationRootDomain()) return null
    const site = await requestSite()
    if (site.kind === 'organization') return site.suspended ? NOBODY : { organizationId: site.organizationId }
    return site.kind === 'unknown' ? NOBODY : { organizationId: null }
}
