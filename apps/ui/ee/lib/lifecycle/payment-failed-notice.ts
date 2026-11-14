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

async function messageOwner(supabase: SupabaseClient<Database>, workspaceId: number, team: TeamMember[], userId: string, invoice: DeclinedInvoice): Promise<void> {
    await deliverWhatsApp(supabase, {
        userId,
        workspaceId,
        message: paymentFailedMessage({ imageUrl: teamBoardUrl(team, 'working'), team: teamLabel(team.map(agent => agent.name)), path: '?billing=1' }),
        language: 'en',
        dedupeKey: invoice.id ? `payment_failed:${invoice.id}` : null,
    })
}

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
        console.error('[lifecycle] payment failed notice failed', err)
    }
}
