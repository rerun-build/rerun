// The notice the sweeper does not own. A declined charge leaves the workspace a day before the
// teardown pauses it, and that day only counts if the owner hears about it the minute it starts.
//
// No 'server-only', for the same reason as trial-receipt.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { selectWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import type { Database } from '@/app/api/database.types'
import { alertBanner, BANNER_WARM_INLINE_MS } from '@/lib/email/board-banner'
import { brandAppUrl } from '@/lib/brand/urls'
import { workspaceBrand } from '@/lib/brand/workspace'
import { emailTimeLabel } from '@/lib/email/date-labels'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { sendPaymentFailedEmail } from '@/ee/lib/email/lifecycle-emails'
import { PAYMENT_FAILED_GRACE_MS } from '@/ee/lib/billing/grace'
import { deliverWhatsApp } from '@/lib/whatsapp/send'
import { causeAlertBoard } from '@/lib/og/alert-crew'
import { loadTeam, type TeamMember } from '@/lib/og/team-board'
import { teamBoardUrl } from '@/lib/whatsapp/team'
import { paymentFailedMessage, teamLabel } from '@/lib/whatsapp/templates'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { selectSingle } from '@/supabase/supabase-helpers'
import { formatAmount, type Brand } from '@rerun/contracts'
import { loadRecipient } from './recipient'
import { recordLifecycleEmail } from './store'

const SEQUENCE_KEY = 'payment_failed' as const

export type DeclinedInvoice = {
    id: string | null
    amountDueCents: number
    currency: string
    hostedUrl: string | null
    // Never charged before. After a trial its email is `trial_ended`, which the sweeper sends with what
    // the trial produced, so only the WhatsApp message leaves from here.
    firstCharge: boolean
}

async function emailAdmin(supabase: SupabaseClient<Database>, workspace: { id: number; name: string | null }, brand: Brand, boardUrl: string | undefined, userId: string, invoice: DeclinedInvoice, now: Date): Promise<void> {
    const recipient = await loadRecipient(supabase, userId)
    if (!recipient) return

    const locale = await recipientLocale(supabase, userId, workspace.id)
    const result = await sendPaymentFailedEmail(
        { to: recipient.email, unsubscribeUrl: null, locale, brand },
        {
            workspaceName: workspace.name,
            amountLabel: invoice.amountDueCents > 0 ? formatAmount(invoice.amountDueCents, invoice.currency) : undefined,
            pausedLabel: emailTimeLabel(new Date(now.getTime() + PAYMENT_FAILED_GRACE_MS), locale),
            firstCharge: invoice.firstCharge,
            billingUrl: invoice.hostedUrl ?? `${brandAppUrl(brand)}/?${WORKSPACE_PARAM}=${workspace.id}&billing=1`,
            boardUrl,
        },
    )
    await recordLifecycleEmail(supabase, { sequenceKey: SEQUENCE_KEY, userId, workspaceId: workspace.id, agentId: null }, result.ok ? 'sent' : 'failed', { invoice_id: invoice.id })
}

async function emailAdmins(supabase: SupabaseClient<Database>, workspace: { id: number; name: string | null }, invoice: DeclinedInvoice, now: Date): Promise<void> {
    const { data: admins } = await selectWorkspaceMembers(supabase, ['user_id'] as const, { workspace_id: workspace.id, role: 'admin' })
    if (!admins?.length) return
    const brand = await workspaceBrand(workspace.id)
    const boardUrl = await alertBanner(causeAlertBoard(supabase, workspace.id, 'payment'), BANNER_WARM_INLINE_MS, brand)
    const results = await Promise.allSettled(admins.map(admin => emailAdmin(supabase, workspace, brand, boardUrl, admin.user_id, invoice, now)))
    for (const result of results) if (result.status === 'rejected') console.error('[lifecycle] payment failed email failed', result.reason)
}

// The button cannot carry Stripe's hosted invoice, which lives on another domain: the billing
// dialog offers the same payment.
async function messageOwner(supabase: SupabaseClient<Database>, workspaceId: number, team: TeamMember[], userId: string, invoice: DeclinedInvoice): Promise<void> {
    await deliverWhatsApp(supabase, {
        userId,
        workspaceId,
        message: paymentFailedMessage({ imageUrl: teamBoardUrl(team, 'working'), team: teamLabel(team.map(agent => agent.name)), path: '?billing=1' }),
        language: 'en',
        dedupeKey: invoice.id ? `payment_failed:${invoice.id}` : null,
    })
}

/**
 * Says that a charge was declined and the workspace is paused in a day: to its admins by email, to its
 * owner by WhatsApp, each on its own, since an account born from a phone number has no address.
 * Mandatory, like every end-of-access notice: no preference is read and no unsubscribe link travels
 * with the email.
 *
 * The caller sends it for the first declined attempt only. There is no unique index behind this
 * sequence, because a workspace can miss a renewal more than once in its life; the row is the trace.
 */
export async function sendPaymentFailedNotice(supabase: SupabaseClient<Database>, workspaceId: number, invoice: DeclinedInvoice, now: Date = new Date()): Promise<void> {
    try {
        const { data: workspace } = await selectSingle(supabase, 'workspaces', ['id', 'name', 'is_sandbox', 'trial_ends_at', 'organization_id'] as const, { id: workspaceId })
        if (!workspace || workspace.is_sandbox || isManagedWorkspace(workspace)) return

        const { data: members } = await selectWorkspaceMembers(supabase, ['user_id'] as const, { workspace_id: workspaceId })
        const owner = members?.[0]
        if (!owner) return

        const team = await loadTeam(supabase, workspaceId)
        const results = await Promise.allSettled([invoice.firstCharge && workspace.trial_ends_at ? null : emailAdmins(supabase, workspace, invoice, now), messageOwner(supabase, workspaceId, team, owner.user_id, invoice)])
        for (const result of results) if (result.status === 'rejected') console.error('[lifecycle] payment failed notice failed', result.reason)
    } catch (err) {
        // A notice is never worth failing a Stripe webhook over.
        console.error('[lifecycle] payment failed notice failed', err)
    }
}
