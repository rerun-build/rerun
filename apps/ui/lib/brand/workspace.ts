// No 'server-only', see lib/email/client.ts: the Trigger.dev tasks read it for the emails they send.
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { organizationBrandOfAccount, organizationBrandOfWorkspace, organizationDefaultUrlOfWorkspace } from '@rerun/cloud/organizations.server'
import { brandAppUrl } from './urls'

// The brand a workspace's emails are sent under, outside any request.
export async function workspaceBrand(workspaceId: number): Promise<Brand> {
    return (await organizationBrandOfWorkspace(workspaceId)) ?? RERUN_BRAND
}

// Where the people of a workspace open the app.
export async function workspaceAppUrl(workspaceId: number): Promise<string> {
    return brandAppUrl(await workspaceBrand(workspaceId))
}

// The same, for an address a third party keeps calling for years.
export async function workspaceStableUrl(workspaceId: number): Promise<string | null> {
    return organizationDefaultUrlOfWorkspace(workspaceId)
}

// A sign-in code is about an address before it is about a workspace: asked for on an organization's
// own address it carries that brand already, and everywhere else the one of the only organization
// the account deals with. A brand that could not be read never holds a sign-in back.
export async function authEmailBrand(request: { email: string; userId: string | null }): Promise<Brand> {
    try {
        return (await organizationBrandOfAccount(request)) ?? RERUN_BRAND
    } catch (err) {
        console.error('[brand] could not read the brand of a sign-in email', err)
        return RERUN_BRAND
    }
}
