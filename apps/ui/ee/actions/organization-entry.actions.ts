'use server'

import { AuthorizationError } from '@/app/api/_auth/errors'
import { requireOrganizationContext } from '@/ee/services/organization-context.service'

// Whether the app offers its reader the console of an organization.
export async function inOrganizationTeamAction(): Promise<boolean> {
    try {
        await requireOrganizationContext()
        return true
    } catch (err) {
        if (!(err instanceof AuthorizationError)) console.error('[organizations] could not read whether the caller is in a team', err)
        return false
    }
}
