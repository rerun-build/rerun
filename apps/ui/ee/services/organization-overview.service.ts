import 'server-only'
import type { OrganizationContext } from '@/ee/services/organization-context.service'
import { reserveBalanceMicros } from '@/ee/services/organization-credit.service'
import { listOrganizationWorkspaces, type OrganizationWorkspaceSummary } from '@/ee/services/organization-workspaces.service'

export type OrganizationOverview = { workspaces: OrganizationWorkspaceSummary[]; maxWorkspaces: number; reserveMicros: number }

// What every page of the console shows: its workspaces, and what is left to give them.
export async function loadOrganizationOverview(ctx: OrganizationContext): Promise<OrganizationOverview> {
    const [workspaces, reserveMicros] = await Promise.all([listOrganizationWorkspaces(ctx), reserveBalanceMicros(ctx.supabase, ctx.organization.id)])
    return { workspaces, maxWorkspaces: ctx.organization.max_workspaces, reserveMicros }
}
