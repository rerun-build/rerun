import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'
import { CONSOLE_HOME } from '@/ee/lib/organizations/console-routes'
import { requireOrganizationContext, type OrganizationContext } from '@/ee/services/organization-context.service'
import { listOrganizationDomains } from '@/ee/services/organization-domains.service'
import { listOrganizationTeam } from '@/ee/services/organization-team.service'
import { organizationRootDomain } from '@/lib/brand/root-domain'
import { loadOrganizationOverview, type OrganizationOverview } from '@/ee/services/organization-overview.service'
import { loadOrganizationWorkspace, type OrganizationWorkspaceDetail } from '@/ee/services/organization-workspaces.service'
import { displayNameOf, readProfile } from '@/lib/auth/user-profile'
import { realEmail } from '@/lib/auth/placeholder-email'
import { routes } from '@/lib/routes'
import { getSessionIdentity } from '@/supabase/session/getServerSession'
import type { ConsoleViewer } from '@/ee/components/organization/ConsoleProvider'

async function orNotFound<Answer>(reading: Promise<Answer>): Promise<Answer> {
    try {
        return await reading
    } catch (err) {
        if (err instanceof UnauthenticatedError) redirect(`${routes.auth}?next=${encodeURIComponent(CONSOLE_HOME)}`)
        if (err instanceof AuthorizationError) notFound()
        throw err
    }
}

// Read once for the layout, the page and its title. Whoever is not in the team of an organization gets
// the answer of an address that does not exist.
export const openConsole = cache((): Promise<OrganizationContext> => orNotFound(requireOrganizationContext()))

const WORKSPACE_ID = /^[1-9]\d{0,14}$/

export const openConsoleWorkspace = cache(async (id: string): Promise<OrganizationWorkspaceDetail> => {
    const ctx = await openConsole()
    if (!WORKSPACE_ID.test(id)) notFound()
    return orNotFound(loadOrganizationWorkspace(ctx, Number(id)))
})

export const openConsoleOverview = cache(async (): Promise<OrganizationOverview> => loadOrganizationOverview(await openConsole()))

export async function openConsoleViewer(): Promise<ConsoleViewer> {
    const identity = await getSessionIdentity()
    return identity ? { name: displayNameOf(identity), email: realEmail(identity.email), photo: readProfile(identity).avatarUrl } : { name: null, email: null, photo: null }
}

// What an agency still has to do before its first client arrives.
export type ConsoleSetup = { brand: boolean; domain: boolean | null; team: boolean }

export async function openConsoleSetup(): Promise<ConsoleSetup> {
    const ctx = await openConsole()
    const [{ domains }, { members, invitations }] = await Promise.all([listOrganizationDomains(ctx), listOrganizationTeam(ctx)])
    return {
        brand: !!ctx.organization.icon_url,
        domain: organizationRootDomain() ? domains.some(domain => domain.status === 'active') : null,
        team: members.length + invitations.length > 1,
    }
}
