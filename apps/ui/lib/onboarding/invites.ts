import 'server-only'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { createWorkspaceInvite, type WorkspaceInviteResult } from '@/app/api/_services/workspace-invite.service'
import { mergeForeman, readAnswers } from '@/lib/foreman/profile'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export const ONBOARDING_INVITES_MAX = 10

// The invitations typed in the onboarding dialog, sent once the team is built: whoever opens one
// lands in a workspace that has something in it. Sent once, whatever happens to each: one refused
// (no seat left, already a member) is not retried, the members panel is where it is sent again.
export async function flushPendingInvites(ctx: WorkspaceContext): Promise<WorkspaceInviteResult[]> {
    const { foreman } = await readAnswers(ctx)
    const pending = foreman?.pendingInvites ?? []
    if (!pending.length || foreman?.invitesSentAt) return []
    await mergeForeman(ctx, { pendingInvites: [], invitesSentAt: new Date().toISOString() })

    const supabase = createServiceRoleClient()
    const inviterEmails = new Map<string, string | null>([[ctx.userId, ctx.userEmail]])
    const results: WorkspaceInviteResult[] = []
    for (const { email, invitedBy } of pending) {
        if (!inviterEmails.has(invitedBy)) inviterEmails.set(invitedBy, (await supabase.auth.admin.getUserById(invitedBy)).data.user?.email ?? null)
        const result = await createWorkspaceInvite({ supabase, workspace: ctx.workspace, inviterId: invitedBy, inviterEmail: inviterEmails.get(invitedBy) ?? null, email, boxScope: 'all' }).catch(
            (err): WorkspaceInviteResult => {
                console.error('[onboarding] an invitation could not be sent', err)
                return { ok: false, email, code: 'sendInvitationFailed' }
            },
        )
        results.push(result)
    }
    const inviteLinks = results.flatMap(result => (result.ok && result.inviteUrl ? [{ email: result.email, link: result.inviteUrl }] : []))
    if (inviteLinks.length) await mergeForeman(ctx, { inviteLinks })
    return results
}
