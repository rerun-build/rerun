import type { SupabaseClient } from '@supabase/supabase-js'
import { captureServer, deterministicUuid } from '@rerun/analytics/server'
import type { Database } from '@/app/api/database.types'
import { APP_URL, type SendEmailResult } from '@/lib/email/client'
import { ARCHIVE_RETENTION_DAYS } from '@/lib/archive/retention'
import {
    sendAgentIdleEmail,
    sendAgentRecommendationsEmail,
    sendArchiveExpiringEmail,
    sendAutomateAgentEmail,
    sendCreatorPitchEmail,
    sendOnboardingResumeEmail,
    sendRenewalReminderEmail,
    sendSubscriptionEndingEmail,
    sendTeamInviteEmail,
    sendTrialEndedEmail,
    sendTrialEndingEmail,
    sendTrialFinalNoticeEmail,
} from '@/ee/lib/email/lifecycle-emails'
import { PLAN_CURRENCY } from '@/ee/lib/billing/plans'
import { stripe } from '@/ee/lib/billing/stripe'
import { formatAmount } from '@rerun/contracts'
import { isRetriableFailure } from '@/lib/email/throttle'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribeToken'
import { BANNER_WARM_BACKGROUND_MS, emailBoardBanner } from '@/lib/email/board-banner'
import { emailDateLabel, emailTimeLabel } from '@/lib/email/date-labels'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { emailTranslator, type EmailTranslator } from '@rerun/emails/i18n'
import type { Locale } from '@rerun/i18n'
import type { TeamStatus } from '@/lib/og/team-board'
import { BOX_DELETION_GRACE_MS, PAYMENT_FAILED_GRACE_MS } from '@/ee/lib/billing/grace'
import { warmTemplateEmailCards } from '@/lib/templates/email-card'
import { loadRecommendCandidates, recommendTemplates } from '@/lib/templates/recommend'
import type { LifecycleCandidate, LifecycleSnapshot } from './decide'
import { loadRecipient, type LifecycleRecipient } from './recipient'
import { LIFECYCLE_SEQUENCES } from './sequences'
import { recordLifecycleEmail } from './store'
import type { UserRow, WorkspaceRow } from './discovery'

type Client = SupabaseClient<Database>

export type DeliverInput = {
    candidate: LifecycleCandidate
    snapshot: LifecycleSnapshot
    user: UserRow
    workspace: WorkspaceRow | undefined
    agentName: string | null
    now: Date
}

export type DeliverResult = { sent: true } | { sent: false; reason: string }

function relativeLabel(from: Date, now: Date, t: EmailTranslator): string {
    const hours = Math.max(1, Math.round((now.getTime() - from.getTime()) / (60 * 60_000)))
    if (hours < 24) return t('agentIdle.createdHoursAgo', { count: hours })
    const days = Math.round(hours / 24)
    return days === 1 ? t('agentIdle.createdYesterday') : t('agentIdle.createdDaysAgo', { count: days })
}

function keptUntilLabel(pausedAt: Date, locale: Locale): string {
    return emailDateLabel(new Date(pausedAt.getTime() + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60_000), locale)
}

async function trialHasCard(customerId: string | null): Promise<boolean> {
    if (!customerId) return false
    try {
        const [customer, subscriptions] = await Promise.all([stripe.customers.retrieve(customerId), stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 5 })])
        const customerCard = !customer.deleted && !!customer.invoice_settings?.default_payment_method
        return customerCard || subscriptions.data.some(subscription => !!subscription.default_payment_method)
    } catch (err) {
        console.error('[lifecycle] could not read the payment method, sending the no-card notice', customerId, err)
        return false
    }
}

async function openInvoiceUrl(customerId: string | null): Promise<string | null> {
    if (!customerId) return null
    try {
        const invoices = await stripe.invoices.list({ customer: customerId, status: 'open', limit: 1 })
        return invoices.data[0]?.hosted_invoice_url ?? null
    } catch (err) {
        console.error('[lifecycle] could not read the open invoice', customerId, err)
        return null
    }
}

async function renewalAmountLabel(subscriptionId: string | null): Promise<string | undefined> {
    if (!subscriptionId) return undefined
    try {
        const invoice = await stripe.invoices.createPreview({ subscription: subscriptionId })
        return invoice.currency === PLAN_CURRENCY ? formatAmount(invoice.amount_due, invoice.currency) : undefined
    } catch (err) {
        console.error('[lifecycle] could not preview the renewal invoice', subscriptionId, err)
        return undefined
    }
}

function periodLabel(from: Date, now: Date, t: EmailTranslator): string {
    const days = Math.max(1, Math.round((now.getTime() - from.getTime()) / (24 * 60 * 60_000)))
    if (days <= 7) return t('automateAgent.periods.lastWeek')
    return t('automateAgent.periods.lastTwoWeeks')
}

function unsubscribeFor(candidate: LifecycleCandidate): string | null {
    if (LIFECYCLE_SEQUENCES[candidate.sequenceKey].mandatory) return null
    return `${buildUnsubscribeUrl(candidate.userId)}&category=${candidate.category}`
}

function daysUntil(deadline: Date, now: Date): number {
    return Math.max(1, Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60_000)))
}

async function build(supabase: Client, input: DeliverInput, recipient: LifecycleRecipient, locale: Locale): Promise<{ send: () => Promise<SendEmailResult> } | { skip: string }> {
    const { candidate, snapshot, workspace, agentName, now } = input
    const to = { to: recipient.email, unsubscribeUrl: unsubscribeFor(candidate), locale }
    const t = emailTranslator(locale)
    const dateLabel = (value: Date) => emailDateLabel(value, locale)
    const timeLabel = (value: Date) => emailTimeLabel(value, locale)
    const agentUrl = candidate.agentId ? `${APP_URL}/?agent=${candidate.agentId}` : APP_URL
    const billingUrl = `${APP_URL}/?billing=1`
    const banner = (status: TeamStatus) => emailBoardBanner(supabase, candidate.workspaceId, status, BANNER_WARM_BACKGROUND_MS)

    switch (candidate.sequenceKey) {
        case 'onboarding_resume':
            return { send: () => sendOnboardingResumeEmail(to, { firstName: recipient.firstName, resumeUrl: APP_URL }) }

        case 'agent_recommendations': {
            const answers = (workspace?.onboarding_answers ?? null) as Parameters<typeof recommendTemplates>[1]
            const candidates = await loadRecommendCandidates(supabase)
            const result = await recommendTemplates(candidates, answers, { appUrl: APP_URL, now })
            if (!result.ok) return { skip: 'no solid recommendation' }
            const company = answers as { company_name?: string; company_url?: string } | null

            const ready = await warmTemplateEmailCards(result.picks.map(pick => pick.imageUrl))
            const templates = result.picks.map(pick => (ready.has(pick.imageUrl) ? pick : { ...pick, imageUrl: undefined }))

            return {
                send: () =>
                    sendAgentRecommendationsEmail(to, {
                        companyName: company?.company_name ?? null,
                        websiteDomain: hostnameOf(company?.company_url),
                        templates,
                        browseUrl: APP_URL,
                    }),
            }
        }

        case 'agent_idle': {
            const agent = snapshot.idleAgents.find(entry => entry.id === candidate.agentId)
            if (!agent) return { skip: 'coworker no longer idle' }
            const boardUrl = await banner({ [agent.id]: 'idle' })
            return { send: () => sendAgentIdleEmail(to, { agentName: agent.name, createdLabel: relativeLabel(agent.at, now, t), agentUrl, boardUrl }) }
        }

        case 'team_invite': {
            const boardUrl = await banner('working')
            return { send: () => sendTeamInviteEmail(to, { workspaceName: workspace?.name ?? t('common.yourWorkspace'), agentName: agentName ?? t('teamInvite.fallbackAgent'), inviteUrl: `${APP_URL}/?members=1`, boardUrl }) }
        }

        case 'automate_agent': {
            const agent = snapshot.habitAgents.find(entry => entry.id === candidate.agentId)
            if (!agent) return { skip: 'coworker no longer runs by hand' }
            const boardUrl = await banner({ [agent.id]: 'working' })
            return {
                send: () =>
                    sendAutomateAgentEmail(to, {
                        agentName: agent.name,
                        manualRuns: agent.runs ?? 2,
                        periodLabel: periodLabel(agent.at, now, t),
                        scheduleUrl: agentUrl,
                        boardUrl,
                    }),
            }
        }

        case 'trial_ended': {
            if (!snapshot.trialEndsAt) return { skip: 'no trial' }
            const reason = snapshot.trialPaymentFailed ? 'payment_failed' : 'no_card'
            const invoiceUrl = reason === 'payment_failed' ? await openInvoiceUrl(workspace?.stripe_customer_id ?? null) : null
            const declinedAt = reason === 'payment_failed' && workspace?.payment_failed_at ? new Date(workspace.payment_failed_at) : null
            const pausedAt = declinedAt ? new Date(declinedAt.getTime() + PAYMENT_FAILED_GRACE_MS) : new Date(now.getTime() + BOX_DELETION_GRACE_MS)
            const boardUrl = await banner('offline')
            return {
                send: () =>
                    sendTrialEndedEmail(to, {
                        reason,
                        workspaceName: workspace?.name ?? null,
                        trialEndedLabel: dateLabel(snapshot.trialEndsAt as Date),
                        pausedLabel: timeLabel(pausedAt),
                        keptUntilLabel: keptUntilLabel(pausedAt, locale),
                        summary: snapshot.successfulRuns > 0 ? { agents: snapshot.agentCount, runs: snapshot.successfulRuns } : undefined,
                        billingUrl: invoiceUrl ?? billingUrl,
                        boardUrl,
                    }),
            }
        }

        case 'trial_ending_2h': {
            if (!snapshot.trialEndsAt) return { skip: 'no trial' }
            if (snapshot.trialEndsAt <= now) return { skip: 'trial already over' }
            const trialEndsAt = snapshot.trialEndsAt
            const hasCard = await trialHasCard(workspace?.stripe_customer_id ?? null)
            const pausedAt = new Date(trialEndsAt.getTime() + BOX_DELETION_GRACE_MS)
            const boardUrl = await banner('working')
            return {
                send: () =>
                    sendTrialFinalNoticeEmail(to, {
                        hasCard,
                        workspaceName: workspace?.name ?? null,
                        trialEndsLabel: timeLabel(trialEndsAt),
                        pausedLabel: timeLabel(pausedAt),
                        keptUntilLabel: keptUntilLabel(pausedAt, locale),
                        billingUrl,
                        boardUrl,
                    }),
            }
        }

        case 'trial_ending_3d': {
            if (!snapshot.trialEndsAt) return { skip: 'no trial' }
            if (snapshot.trialEndsAt <= now) return { skip: 'trial already over' }
            const trialEndsAt = snapshot.trialEndsAt
            const boardUrl = await banner('working')
            return {
                send: () =>
                    sendTrialEndingEmail(to, {
                        workspaceName: workspace?.name ?? null,
                        trialEndsLabel: dateLabel(trialEndsAt),
                        daysLeft: daysUntil(trialEndsAt, now),
                        keptUntilLabel: keptUntilLabel(new Date(trialEndsAt.getTime() + BOX_DELETION_GRACE_MS), locale),
                        billingUrl,
                        boardUrl,
                    }),
            }
        }

        case 'subscription_ending_7d':
        case 'subscription_ending_3d':
        case 'subscription_ending_24h': {
            if (!snapshot.subscriptionCancelAt) return { skip: 'cancellation withdrawn' }
            const endsAt = snapshot.subscriptionCancelAt
            const boardUrl = await banner('working')
            return {
                send: () =>
                    sendSubscriptionEndingEmail(to, candidate.sequenceKey, {
                        workspaceName: workspace?.name ?? null,
                        endsLabel: dateLabel(endsAt),
                        daysLeft: daysUntil(endsAt, now),
                        keptUntilLabel: keptUntilLabel(endsAt, locale),
                        billingUrl,
                        boardUrl,
                    }),
            }
        }

        case 'workspace_archive_expiring': {
            if (!snapshot.pausedArchive || !snapshot.boxesArchivedAt) return { skip: 'not paused' }
            const archive = snapshot.pausedArchive
            const boardUrl = await banner('offline')
            return {
                send: () =>
                    sendArchiveExpiringEmail(to, {
                        workspaceName: workspace?.name ?? null,
                        pausedLabel: dateLabel(archive.archivedAt),
                        deletionLabel: dateLabel(archive.expiresAt),
                        agentCount: snapshot.agentCount,
                        billingUrl,
                        boardUrl,
                    }),
            }
        }

        case 'renewal_reminder_7d': {
            if (!snapshot.subscriptionPaid || snapshot.subscriptionCancelAt) return { skip: 'no longer renewing' }
            if (!workspace?.current_period_end) return { skip: 'no renewal date' }
            const renewsAt = new Date(workspace.current_period_end)
            if (renewsAt <= now) return { skip: 'renewal already passed' }
            const amountLabel = await renewalAmountLabel(workspace.stripe_subscription_id)
            const boardUrl = await banner('working')
            return {
                send: () =>
                    sendRenewalReminderEmail(to, {
                        workspaceName: workspace.name,
                        renewsLabel: dateLabel(renewsAt),
                        daysLeft: daysUntil(renewsAt, now),
                        amountLabel,
                        billingUrl,
                        boardUrl,
                    }),
            }
        }

        case 'creator_pitch':
            return { send: () => sendCreatorPitchEmail(to, { firstName: recipient.firstName, agentName, creatorUrl: `${APP_URL}/creator` }) }

        case 'trial_started':
        case 'payment_failed':
        case 'sandbox_idle_warning':
            return { skip: 'sent inline, never from the sweeper' }
    }
}

function hostnameOf(url: string | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
    } catch {
        return null
    }
}

export async function deliverLifecycleEmail(supabase: Client, input: DeliverInput): Promise<DeliverResult> {
    const recipient = await loadRecipient(supabase, input.candidate.userId)
    if (!recipient) return { sent: false, reason: 'no address' }

    const locale = await recipientLocale(supabase, input.candidate.userId, input.candidate.workspaceId)
    const built = await build(supabase, input, recipient, locale)
    if ('skip' in built) return { sent: false, reason: built.skip }

    const result = await built.send()
    if (!result.ok) {
        if (isRetriableFailure(result.error)) return { sent: false, reason: result.error }
        await recordLifecycleEmail(supabase, input.candidate, 'failed', { error: result.error })
        return { sent: false, reason: result.error }
    }
    if (result.skipped) return { sent: false, reason: 'no Resend key' }

    const outcome = await recordSent(supabase, input.candidate, result.id)
    if (outcome === 'duplicate') return { sent: false, reason: 'already recorded' }

    await captureServer(
        recipient.email,
        'lifecycle_email_sent',
        { sequence: input.candidate.sequenceKey, category: LIFECYCLE_SEQUENCES[input.candidate.sequenceKey].category },
        { uuid: result.id ? deterministicUuid(`lifecycle_email_sent:${result.id}`) : undefined },
    ).catch(err => console.error('[lifecycle] analytics capture failed', err))

    if (outcome === 'failed') return { sent: false, reason: 'delivered but not recorded, the next sweep may send it again' }
    return { sent: true }
}

async function recordSent(supabase: Client, candidate: LifecycleCandidate, emailId: string | null) {
    const outcome = await recordLifecycleEmail(supabase, candidate, 'sent', { emailId })
    return outcome === 'failed' ? recordLifecycleEmail(supabase, candidate, 'sent', { emailId }) : outcome
}
