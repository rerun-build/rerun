import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'
import { CONSOLE_HOME } from '@/ee/lib/organizations/console-routes'
import { requireOrganizationContext, type OrganizationContext } from '@/ee/services/organization-context.service'
import { loadOrganizationWorkspace, type OrganizationWorkspaceDetail } from '@/ee/services/organization-workspaces.service'
import { routes } from '@/lib/routes'

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
