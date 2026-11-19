import type { MemberProfile } from '@moldwright/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { WorkspaceContext, WorkspaceRole } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { displayNameOf, readProfile } from '@/app/api/_services/me.service'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'

type MemberIdentity = { email: string | null; name: string | null; avatarUrl: string | null }

export async function resolveMemberIdentities(supabase: SupabaseClient<Database>, userIds: string[]): Promise<Map<string, MemberIdentity>> {
    const identities = new Map<string, MemberIdentity>()
    await Promise.all(
        userIds.map(async id => {
            const { data } = await supabase.auth.admin.getUserById(id)
            if (!data.user) return
            identities.set(id, { email: accountLabel(data.user.email?.toLowerCase()), name: displayNameOf(data.user), avatarUrl: readProfile(data.user).avatarUrl })
        }),
    )
    return identities
}

export async function listMemberProfiles({ workspace, supabase }: WorkspaceContext): Promise<MemberProfile[]> {
    const { data: memberRows } = await selectAll(supabase, 'workspace_members', ['user_id', 'role'] as const, { workspace_id: workspace.id }, { column: 'created_at', ascending: true })
    const rows = memberRows ?? []
    const identities = await resolveMemberIdentities(supabase, rows.map(m => m.user_id))
    return rows.map(({ user_id: id, role }) => ({ id, name: identities.get(id)?.name ?? null, avatarUrl: identities.get(id)?.avatarUrl ?? null, role }))
}

export const LAST_ADMIN = 'The workspace needs at least one admin'

export async function isLastAdmin(supabase: SupabaseClient<Database>, workspaceId: number, userId: string): Promise<boolean> {
    const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['role'] as const, { workspace_id: workspaceId, user_id: userId })
    if (target?.role !== 'admin') return false
    const { data: admins } = await selectCount(supabase, 'workspace_members', { workspace_id: workspaceId, role: 'admin' })
    return (admins ?? 0) <= 1
}

export async function setMemberRole(supabase: SupabaseClient<Database>, workspaceId: number, userId: string, role: WorkspaceRole): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('workspace_members')
        .update<Database['public']['Tables']['workspace_members']['Update']>({ role })
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
    return { error: error?.message ?? null }
}

export async function demoteKeepingAnAdmin(supabase: SupabaseClient<Database>, workspaceId: number, userId: string): Promise<{ error: string | null }> {
    const { error } = await setMemberRole(supabase, workspaceId, userId, 'member')
    if (error) return { error }
    const { data: admins } = await selectCount(supabase, 'workspace_members', { workspace_id: workspaceId, role: 'admin' })
    if ((admins ?? 0) > 0) return { error: null }
    const { error: restoreError } = await setMemberRole(supabase, workspaceId, userId, 'admin')
    return { error: restoreError ?? LAST_ADMIN }
}
