import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { moveToOtherWorkspace } from '@/app/api/_services/default-workspace.service'
import { revokeMemberComputers } from '@/app/api/_services/remote-computers.service'
import { batchesOf } from '@/ee/lib/organizations/batches'
import { requireOrganizationWorkspace, type OrganizationContext } from '@/ee/services/organization-context.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectCount, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError } from '@/lib/i18n/action-error'

type Client = SupabaseClient<Database>
type MemberInsert = Database['public']['Tables']['workspace_members']['Insert']
type UserUpdate = Database['public']['Tables']['users']['Update']

// The team of an organization inside the workspaces of its clients: full members for the session,
// invisible to the client.

function leaveWorkspaceAsStaff(supabase: Client, userId: string, workspaceId: number) {
    return supabase.from('workspace_members').delete().eq('user_id', userId).eq('workspace_id', workspaceId).eq('organization_staff', true)
}

// Someone who already is an ordinary member stays one.
export async function openOrganizationWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<void> {
    const { supabase, userId, organization } = ctx
    await requireOrganizationWorkspace(ctx, workspaceId)

    const { error } = await supabase
        .from('workspace_members')
        .upsert<MemberInsert>({ user_id: userId, workspace_id: workspaceId, role: 'admin', organization_staff: true }, { onConflict: 'user_id,workspace_id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)

    // Read again once the row is written: someone taken off the team, or a workspace taken out of the
    // organization, meanwhile had its rows swept before this one landed.
    const [{ data: stillThere }, { data: stillOurs }] = await Promise.all([
        selectMaybeSingle(supabase, 'organization_members', ['user_id'] as const, { organization_id: organization.id, user_id: userId }),
        selectMaybeSingle(supabase, 'workspaces', ['id'] as const, { id: workspaceId, organization_id: organization.id }),
    ])
    if (!stillThere || !stillOurs) {
        await leaveWorkspaceAsStaff(supabase, userId, workspaceId)
        throw new AppError('notAuthorized')
    }

    const { error: switchError } = await supabase.from('users').update<UserUpdate>({ workspace_id: workspaceId }).eq('id', userId)
    if (switchError) throw new Error(switchError.message)
}

// Out of every workspace of the organization's clients. Run again without harm: before the person is
// off the team, so that a failure leaves them where they can be removed again, and once more after,
// for a workspace opened in between.
export async function removeStaff(supabase: Client, organizationId: string, userId: string): Promise<void> {
    const { data: rows, error } = await selectAll(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId, organization_staff: true })
    if (error) throw new Error(error.message)

    const ids: number[] = []
    for (const batch of batchesOf(rows.map(row => row.workspace_id))) {
        const { data: own, error: ownError } = await selectMany(supabase, 'workspaces', ['id'] as const, { organization_id: organizationId, id: batch })
        if (ownError) throw new Error(ownError.message)
        ids.push(...(own ?? []).map(workspace => workspace.id))
    }
    if (ids.length === 0) return

    // All the rows first: the workspace they are moved to must not be one they are leaving too.
    for (const batch of batchesOf(ids)) {
        const { error: deleteError } = await supabase.from('workspace_members').delete().eq('user_id', userId).eq('organization_staff', true).in('workspace_id', batch)
        if (deleteError) throw new Error(deleteError.message)
    }

    const { data: user } = await selectMaybeSingle(supabase, 'users', ['workspace_id'] as const, { id: userId })
    if (user && ids.includes(user.workspace_id)) await moveToOtherWorkspace(supabase, userId, user.workspace_id, { openOne: true })
    for (const id of ids) await revokeMemberComputers(id, userId).catch(err => console.warn('[organizations] computers of a former team member left linked until they reconnect', err))
}

// Called once the workspace is out of the organization, so that nothing can open it behind it.
export async function removeStaffFromWorkspace(supabase: Client, workspaceId: number): Promise<void> {
    const { data: rows, error } = await selectAll(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, organization_staff: true })
    if (error) throw new Error(error.message)
    if (rows.length === 0) return

    const { error: deleteError } = await supabase.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('organization_staff', true)
    if (deleteError) throw new Error(deleteError.message)
    for (const { user_id } of rows) {
        await moveToOtherWorkspace(supabase, user_id, workspaceId, { openOne: true })
        await revokeMemberComputers(workspaceId, user_id).catch(err => console.warn('[organizations] computers of a former team member left linked until they reconnect', err))
    }
}

// Before an account is deleted. Refused to the last owner of an organization, which would be left with
// nobody to run its team, its brand and its credit: they hand it over first.
export async function leaveOrganizations(userId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: memberships, error } = await selectAll(supabase, 'organization_members', ['organization_id', 'role'] as const, { user_id: userId })
    if (error) throw new Error(error.message)
    for (const { organization_id, role } of memberships) {
        if (role !== 'owner') continue
        const { data: owners, error: ownersError } = await selectCount(supabase, 'organization_members', { organization_id, role: 'owner' })
        if (ownersError || owners === null) throw new Error(ownersError?.message ?? 'Could not count the owners')
        if (owners <= 1) throw new AppError('organizationNeedsOwner')
    }
    for (const { organization_id } of memberships) {
        await removeStaff(supabase, organization_id, userId)
        const { error: deleteError } = await supabase.from('organization_members').delete().eq('organization_id', organization_id).eq('user_id', userId)
        if (deleteError) throw new Error(deleteError.message)
        await removeStaff(supabase, organization_id, userId)
    }
}
