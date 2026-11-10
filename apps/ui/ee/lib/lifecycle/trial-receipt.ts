// The one lifecycle email the sweeper does not own. A receipt that lands fifteen minutes after the
// fact is a worse receipt, so this goes out inline from the billing service.
//
// No 'server-only': billing.service.ts is a Next module, but this file also has to stay importable
// from the sweeper's bundle so both paths share the same guards.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { PLAN_CURRENCY, basePriceCents, parsePriceArm } from '@/ee/lib/billing/plans'
import { BANNER_WARM_INLINE_MS, emailBoardBanner } from '@/lib/email/board-banner'
import { APP_URL } from '@/lib/email/client'
import { emailDateLabel } from '@/lib/email/date-labels'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { sendTrialStartedEmail } from '@/ee/lib/email/lifecycle-emails'
import { wantsCategoryEmail } from '@/lib/notifications/prefs'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribeToken'
import { selectMany, selectSingle } from '@/supabase/supabase-helpers'
import { TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS, formatAmount } from '@rerun/contracts'
import { emailTranslator } from '@rerun/emails/i18n'
import { loadRecipient } from './recipient'
import { recordLifecycleEmail } from './store'

const SEQUENCE_KEY = 'trial_started' as const

/**
 * `applySubscriptionToWorkspace` runs from the trial start and again from every
 * `customer.subscription.*` webhook, so this is deliberately not gated on "trial_ends_at was null
 * before": it is gated on the unique index over (workspace_id, 'trial_started'), which is the only
 * thing that survives a webhook replay.
 */
export async function sendTrialStartedReceipt(supabase: SupabaseClient<Database>, workspaceId: number, trialEndsAt: string, trialDays: number, hasCard: boolean): Promise<void> {
    try {
        const { data: workspace } = await selectSingle(supabase, 'workspaces', ['id', 'name', 'is_sandbox', 'price_arm'] as const, { id: workspaceId })
        if (!workspace || workspace.is_sandbox) return

        const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId }, { column: 'created_at' }, 1)
        const owner = members?.[0]
        if (!owner) return

        const { data: user } = await selectSingle(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: owner.user_id })
        if (!user || !wantsCategoryEmail(user.email_notification_prefs, 'billing')) return

        // Claim the slot before sending: two webhooks landing together must not both mail.
        const claimed = await recordLifecycleEmail(supabase, { sequenceKey: SEQUENCE_KEY, userId: owner.user_id, workspaceId, agentId: null }, 'sent')
        if (claimed !== 'recorded') return

        const recipient = await loadRecipient(supabase, owner.user_id)
        if (!recipient) return

        const locale = await recipientLocale(supabase, owner.user_id, workspaceId)
        const boardUrl = await emailBoardBanner(supabase, workspaceId, 'working', BANNER_WARM_INLINE_MS)
        await sendTrialStartedEmail(
            { to: recipient.email, unsubscribeUrl: `${buildUnsubscribeUrl(owner.user_id)}&category=billing`, locale },
            {
                workspaceName: workspace.name,
                trialDays,
                trialEndsLabel: emailDateLabel(new Date(trialEndsAt), locale),
                // The price this workspace is sold the plan at, before any promotion code entered at
                // Checkout: it lowers the first charge, and overstating is the safe direction for a receipt.
                monthlyPriceLabel: formatAmount(basePriceCents(parsePriceArm(workspace.price_arm)), PLAN_CURRENCY),
                includedLabel: emailTranslator(locale)('trialStarted.included', { coworkers: TRIAL_ACTIVE_AGENTS, credits: TRIAL_CREDITS }),
                hasCard,
                workspaceUrl: APP_URL,
                boardUrl,
            },
        )
    } catch (err) {
        // A receipt is never worth failing a Stripe webhook over.
        console.error('[lifecycle] trial receipt failed', err)
    }
}
