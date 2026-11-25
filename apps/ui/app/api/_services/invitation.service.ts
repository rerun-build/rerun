import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import { toBoxScope } from '@/app/api/_auth/box-scope'
import { countWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type InvitationUpdate = Database['public']['Tables']['workspace_invitations']['Update']
type MemberInsert = Database['public']['Tables']['workspace_members']['Insert']
type MemberUpdate = Database['public']['Tables']['workspace_members']['Update']

export const INVITATION_COLUMNS = ['id', 'workspace_id', 'email', 'status', 'expires_at', 'box_scope', 'role'] as const

export type PendingInvitation = Pick<Database['public']['Tables']['workspace_invitations']['Row'], 'id' | 'workspace_id' | 'box_scope' | 'role'>

export type InvitationOutcome = { ok: true } | { ok: false; reason: 'claimed' | 'noSeat' } | { ok: false; reason: 'failed'; message: string }

// Turns a pending invitation into a membership. The caller has checked that it is this person's and
// still good. `beforeMember` runs once the invitation is theirs, for an account that has no row yet.
export async function takeInvitation(supabase: Client, userId: string, invitation: PendingInvitation, beforeMember?: () => Promise<string | null>): Promise<InvitationOutcome> {
    // Claimed before the seats are counted: only one tab can move it off `pending`, so only one gets to count and insert.
    const { data: claimed } = await supabase
        .from('workspace_invitations')
        .update<InvitationUpdate>({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
    if (!claimed) return { ok: false, reason: 'claimed' }

    const release = () => supabase.from('workspace_invitations').update<InvitationUpdate>({ status: 'pending', accepted_at: null }).eq('id', invitation.id).eq('status', 'accepted')

    const { data: existing } = await selectMaybeSingle(supabase, 'workspace_members', ['organization_staff'] as const, { user_id: userId, workspace_id: invitation.workspace_id })
    if (existing && !existing.organization_staff) return { ok: true }

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['max_seats'] as const, { id: invitation.workspace_id })
    const { data: seatsTaken } = await countWorkspaceMembers(supabase, { workspace_id: invitation.workspace_id })
    if (workspace?.max_seats != null && (seatsTaken ?? 0) >= workspace.max_seats) {
        await release()
        return { ok: false, reason: 'noSeat' }
    }

    const membership = { role: invitation.role, box_scope: toBoxScope(invitation.box_scope) }
    const refused = (await beforeMember?.()) ?? (await writeMember(supabase, userId, invitation.workspace_id, membership, !!existing))
    if (refused === null) return { ok: true }
    await release()
    return { ok: false, reason: 'failed', message: refused }
}

// Someone of the organization's team who is invited by name becomes an ordinary member.
async function writeMember(supabase: Client, userId: string, workspaceId: number, membership: Pick<MemberInsert, 'role' | 'box_scope'>, wasStaff: boolean): Promise<string | null> {
    const { error } = wasStaff
        ? await supabase.from('workspace_members').update<MemberUpdate>({ ...membership, organization_staff: false }).eq('user_id', userId).eq('workspace_id', workspaceId)
        : await supabase.from('workspace_members').insert<MemberInsert>({ user_id: userId, workspace_id: workspaceId, ...membership })
    return error?.message ?? null
}
