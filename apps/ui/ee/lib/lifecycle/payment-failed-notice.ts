// The notice the sweeper does not own. A declined charge leaves the workspace a day before the
// teardown pauses it, and that day only counts if the owner hears about it the minute it starts.
//
// No 'server-only', for the same reason as trial-receipt.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { ARCHIVE_RETENTION_DAYS } from '@/lib/archive/retention'
import { BANNER_WARM_INLINE_MS, teamBoardBanner } from '@/lib/email/board-banner'
import { APP_URL } from '@/lib/email/client'
import { emailDateLabel, emailTimeLabel } from '@/lib/email/date-labels'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { sendPaymentFailedEmail } from '@/ee/lib/email/lifecycle-emails'
import { PAYMENT_FAILED_GRACE_MS } from '@/ee/lib/billing/grace'
import { deliverWhatsApp } from '@/lib/whatsapp/send'
import { loadTeam, type TeamMember } from '@/lib/og/team-board'
import { teamBoardUrl } from '@/lib/whatsapp/team'
import { paymentFailedMessage, teamLabel } from '@/lib/whatsapp/templates'
import { selectMany, selectSingle } from '@/supabase/supabase-helpers'
import { formatAmount } from '@rerun/contracts'
import { loadRecipient } from './recipient'
import { recordLifecycleEmail } from './store'

const SEQUENCE_KEY = 'payment_failed' as const
const DAY_MS = 24 * 60 * 60_000

export type DeclinedInvoice = {
    id: string | null
    amountDueCents: number
    currency: string
    hostedUrl: string | null
    // A trial's first charge. Its email is `trial_ended`, which the sweeper sends with what the
    // trial produced, so only the WhatsApp message leaves from here.
    firstCharge: boolean
}

async function emailOwner(supabase: SupabaseClient<Database>, workspace: { id: number; name: string | null }, team: TeamMember[], userId: string, invoice: DeclinedInvoice, now: Date): Promise<void> {
    const recipient = await loadRecipient(supabase, userId)
    if (!recipient) return

    const locale = await recipientLocale(supabase, userId, workspace.id)
    const pausedAt = new Date(now.getTime() + PAYMENT_FAILED_GRACE_MS)
    const boardUrl = await teamBoardBanner(team, 'working', BANNER_WARM_INLINE_MS)
    const result = await sendPaymentFailedEmail(
        { to: recipient.email, unsubscribeUrl: null, locale },
        {
            workspaceName: workspace.name,
            amountLabel: invoice.amountDueCents > 0 ? formatAmount(invoice.amountDueCents, invoice.currency) : undefined,
            declinedLabel: emailDateLabel(now, locale),
            pausedLabel: emailTimeLabel(pausedAt, locale),
            keptUntilLabel: emailDateLabel(new Date(pausedAt.getTime() + ARCHIVE_RETENTION_DAYS * DAY_MS), locale),
            billingUrl: invoice.hostedUrl ?? `${APP_URL}/?billing=1`,
            boardUrl,
        },
    )
    await recordLifecycleEmail(supabase, { sequenceKey: SEQUENCE_KEY, userId, workspaceId: workspace.id, agentId: null }, result.ok ? 'sent' : 'failed', { invoice_id: invoice.id })
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
 * Tells the owner their charge was declined and their workspace is paused in a day, by WhatsApp and
 * by email, each on its own: an account born from a phone number has no address to write to.
 * Mandatory, like every end-of-access notice: no preference is read and no unsubscribe link travels
 * with the email.
 *
 * The caller sends it for the first declined attempt only. There is no unique index behind this
 * sequence, because a workspace can miss a renewal more than once in its life; the row is the trace.
 */
export async function sendPaymentFailedNotice(supabase: SupabaseClient<Database>, workspaceId: number, invoice: DeclinedInvoice, now: Date = new Date()): Promise<void> {
    try {
        const { data: workspace } = await selectSingle(supabase, 'workspaces', ['id', 'name', 'is_sandbox'] as const, { id: workspaceId })
        if (!workspace || workspace.is_sandbox) return

        const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId }, { column: 'created_at' }, 1)
        const owner = members?.[0]
        if (!owner) return

        const team = await loadTeam(supabase, workspaceId)
        const results = await Promise.allSettled([invoice.firstCharge ? null : emailOwner(supabase, workspace, team, owner.user_id, invoice, now), messageOwner(supabase, workspaceId, team, owner.user_id, invoice)])
        for (const result of results) if (result.status === 'rejected') console.error('[lifecycle] payment failed notice failed', result.reason)
    } catch (err) {
        // A notice is never worth failing a Stripe webhook over.
        console.error('[lifecycle] payment failed notice failed', err)
    }
}
