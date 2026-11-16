import 'server-only'

import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { toBoxScope, type BoxScope } from '@/app/api/_auth/box-scope'
import type { Database } from '@/app/api/database.types'
import { resolveMemberIdentities } from '@/app/api/_services/members.service'
import { BANNER_WARM_BACKGROUND_MS, EMAIL_DELIVERY, emailBoardBanner, sendWorkspaceInviteEmail } from '@rerun/cloud/email'
import type { ErrorCode } from '@/lib/i18n/action-error'
import { workspaceLocale } from '@/lib/i18n/recipient-locale'
import { randomUuid } from '@/lib/random-uuid'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { emailTranslator } from '@rerun/emails/i18n'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'

type InvitationInsert = Database['public']['Tables']['workspace_invitations']['Insert']
type InvitationUpdate = Database['public']['Tables']['workspace_invitations']['Update']

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rerun.build'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function resolveMemberEmails(supabase: SupabaseClient<Database>, userIds: string[]): Promise<Map<string, string>> {
    const identities = await resolveMemberIdentities(supabase, userIds)
    const emails = new Map<string, string>()
    for (const [id, identity] of identities) if (identity.email) emails.set(id, identity.email)
    return emails
}

export type WorkspaceInviteInput = {
    supabase: SupabaseClient<Database>
    workspace: { id: number; name: string | null; max_seats: number | null }
    inviterId: string
    inviterEmail: string | null
    email: string
    boxScope: BoxScope
}

// `inviteUrl` comes back where no email leaves, for whoever invites to pass on.
export type WorkspaceInviteResult = { ok: true; email: string; inviteUrl?: string } | { ok: false; email: string; code: ErrorCode }

// One invitation, from the members panel or from the Chief of Staff: the seats are counted, an
// invitation still pending is reused (its Box scope updated), and the email leaves after the response.
export async function createWorkspaceInvite({ supabase, workspace, inviterId, inviterEmail, email: rawEmail, boxScope: rawBoxScope }: WorkspaceInviteInput): Promise<WorkspaceInviteResult> {
    const boxScope = toBoxScope(rawBoxScope)
    const email = rawEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return { ok: false, email, code: 'invalidEmailShort' }

    const { data: memberRows } = await selectAll(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspace.id })
    const memberIds = (memberRows ?? []).map(m => m.user_id)
    const memberEmails = await resolveMemberEmails(supabase, memberIds)
    if ([...memberEmails.values()].includes(email)) return { ok: false, email, code: 'alreadyMember' }

    const { data: existingInvite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['id', 'token', 'box_scope'] as const, { workspace_id: workspace.id, email, status: 'pending' })

    let token = existingInvite?.token
    if (!existingInvite) {
        const { data: pendingCount } = await selectCount(supabase, 'workspace_invitations', { workspace_id: workspace.id, status: 'pending' })
        const total = memberIds.length + (pendingCount ?? 0)
        if (workspace.max_seats != null && total >= workspace.max_seats) return { ok: false, email, code: 'seatLimit' }

        token = randomUuid()
        const { error } = await supabase.from('workspace_invitations').insert<InvitationInsert>({
            workspace_id: workspace.id,
            email,
            token,
            invited_by: inviterId,
            status: 'pending',
            box_scope: boxScope,
            expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
        })
        if (error) throw new Error(error.message)
    } else if (toBoxScope(existingInvite.box_scope) !== boxScope) {
        const { error } = await supabase.from('workspace_invitations').update<InvitationUpdate>({ box_scope: boxScope }).eq('id', existingInvite.id)
        if (error) throw new Error(error.message)
    }

    // After the response: the invitation is saved, and the board the email opens on can take a
    // cold capture without holding whoever invited.
    const inviteUrl = `${APP_URL}/invite/${token}`
    after(async () => {
        const serviceRole = createServiceRoleClient()
        const boardUrl = await emailBoardBanner(serviceRole, workspace.id, 'working', BANNER_WARM_BACKGROUND_MS)
        const locale = await workspaceLocale(serviceRole, workspace.id)
        const workspaceName = workspace.name ?? emailTranslator(locale)('common.yourWorkspace')
        await sendWorkspaceInviteEmail({ to: email, workspaceName, inviteUrl, invitedByEmail: inviterEmail ?? undefined, boardUrl, locale })
    })

    return EMAIL_DELIVERY ? { ok: true, email } : { ok: true, email, inviteUrl }
}
