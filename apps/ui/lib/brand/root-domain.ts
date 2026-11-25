import { ORGANIZATIONS_ENABLED } from '@rerun/cloud/organizations'

// The domain every organization has an address under (`<slug>.<root>`). Null: no address of the app
// belongs to an organization, and any host is the app's own.
export function organizationRootDomain(): string | null {
    if (!ORGANIZATIONS_ENABLED) return null
    return process.env.ORGANIZATION_ROOT_DOMAIN?.trim().toLowerCase() || null
}
