// No 'server-only', see lib/email/client.ts: the whole lifecycle module is bundled into a
// Trigger.dev task. One function per sequence, each owning its own subject line: the subject is part
// of the copy, and it has no business being assembled at the call site.
import * as React from 'react'
import {
    AgentIdle,
    AgentRecommendations,
    ArchiveExpiring,
    AutomateAgent,
    CreatorPitch,
    OnboardingResume,
    PaymentFailed,
    RenewalReminder,
    SandboxIdle,
    SubscriptionEnding,
    TeamInvite,
    TrialEnded,
    TrialEnding,
    TrialFinalNotice,
    TrialStarted,
    renderEmail,
    type RecommendedTemplate,
    type TrialEndedReason,
    type TrialSummary,
} from '@rerun/emails'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { emailTranslator, type EmailTranslator } from '@rerun/emails/i18n'
import type { Locale } from '@rerun/i18n'
import { brandAppUrl } from '@/lib/brand/urls'
import { MARKETING_FROM, TRANSACTIONAL_FROM, getResendClient, redirectDelivery, type SendEmailResult } from '@/lib/email/client'
import { emailSender } from '@/lib/email/sender'
import { failureMarker, sendThrottled } from '@/lib/email/throttle'
import { listUnsubscribeHeaders } from '@/lib/email/unsubscribeToken'
import { LIFECYCLE_SEQUENCES, type LifecycleSequenceKey } from '@/ee/lib/lifecycle/sequences'

export type { RecommendedTemplate, TrialEndedReason, TrialSummary }

// `unsubscribeUrl` is null for the mandatory end-of-access notices. They travel without a
// List-Unsubscribe header rather than offering an opt-out the sweeper then ignores. Without a locale
// the email is written in English, without a brand it is Rerun's.
type Recipient = { to: string; unsubscribeUrl: string | null; locale?: Locale; brand?: Brand }

// A billing email reports a fact with consequences and has to reach the inbox, so it keeps the
// transactional domain. Everything else here is a nudge nobody asked for, and it answers for its own
// complaints on the marketing domain.
function senderFor(key: LifecycleSequenceKey): string {
    return LIFECYCLE_SEQUENCES[key].category === 'billing' ? TRANSACTIONAL_FROM : MARKETING_FROM
}

function translatorFor({ locale, brand = RERUN_BRAND }: Recipient): EmailTranslator {
    return emailTranslator(locale, brand.name)
}

function frameOf({ unsubscribeUrl, locale, brand = RERUN_BRAND }: Recipient) {
    return { appUrl: brandAppUrl(brand), unsubscribeUrl: unsubscribeUrl ?? undefined, locale, brand }
}

async function deliver(recipient: Recipient, key: LifecycleSequenceKey, subject: string, element: React.ReactElement): Promise<SendEmailResult> {
    const resend = getResendClient()
    if (!resend) {
        console.warn(`[email] RESEND_API_KEY missing, skipping ${key} email`)
        return { ok: true, id: null, skipped: true }
    }

    const { html, text } = await renderEmail(element)
    const delivery = redirectDelivery(recipient.to, subject)

    const { data, error } = await sendThrottled(() =>
        resend.emails.send({
            ...emailSender(recipient.brand ?? RERUN_BRAND, senderFor(key)),
            to: delivery.to,
            subject: delivery.subject,
            html,
            text,
            ...(recipient.unsubscribeUrl ? { headers: listUnsubscribeHeaders(recipient.unsubscribeUrl) } : {}),
        }),
    )
    if (error) {
        console.error(`[email] failed to send ${key} email`, error)
        return { ok: false, error: failureMarker(error) }
    }
    return { ok: true, id: data?.id ?? null }
}

export function sendOnboardingResumeEmail(recipient: Recipient, input: { firstName: string | null; resumeUrl: string }): Promise<SendEmailResult> {
    return deliver(recipient, 'onboarding_resume', translatorFor(recipient)('subjects.onboardingResume'), React.createElement(OnboardingResume, { ...input, ...frameOf(recipient) }))
}

export function sendAgentRecommendationsEmail(
    recipient: Recipient,
    input: { companyName: string | null; websiteDomain: string | null; templates: RecommendedTemplate[]; browseUrl: string },
): Promise<SendEmailResult> {
    const t = translatorFor(recipient)
    const subject = t('subjects.agentRecommendations', { count: input.templates.length, company: input.companyName ?? t('agentRecommendations.yourCompany') })
    return deliver(recipient, 'agent_recommendations', subject, React.createElement(AgentRecommendations, { ...input, ...frameOf(recipient) }))
}

export function sendAgentIdleEmail(recipient: Recipient, input: { agentName: string; createdLabel: string; agentUrl: string; boardUrl?: string }): Promise<SendEmailResult> {
    return deliver(recipient, 'agent_idle', translatorFor(recipient)('subjects.agentIdle', { agentName: input.agentName }), React.createElement(AgentIdle, { ...input, ...frameOf(recipient) }))
}

export function sendTeamInviteEmail(recipient: Recipient, input: { workspaceName: string; agentName: string; inviteUrl: string; boardUrl?: string }): Promise<SendEmailResult> {
    return deliver(recipient, 'team_invite', translatorFor(recipient)('subjects.teamInvite', { workspaceName: input.workspaceName }), React.createElement(TeamInvite, { ...input, ...frameOf(recipient) }))
}

export function sendAutomateAgentEmail(
    recipient: Recipient,
    input: { agentName: string; manualRuns: number; periodLabel: string; lastResult?: string; scheduleUrl: string; boardUrl?: string },
): Promise<SendEmailResult> {
    const subject = translatorFor(recipient)('subjects.automateAgent', { agentName: input.agentName, manualRuns: input.manualRuns })
    return deliver(recipient, 'automate_agent', subject, React.createElement(AutomateAgent, { ...input, ...frameOf(recipient) }))
}

export function sendTrialStartedEmail(recipient: Recipient, input: { workspaceName: string | null; trialDays: number; trialEndsLabel: string; monthlyPriceLabel: string; includedLabel: string; hasCard: boolean; workspaceUrl: string; boardUrl?: string }): Promise<SendEmailResult> {
    return deliver(recipient, 'trial_started', translatorFor(recipient)('subjects.trialStarted', { trialDays: input.trialDays }), React.createElement(TrialStarted, { ...input, ...frameOf(recipient) }))
}

export function sendTrialEndingEmail(recipient: Recipient, input: { workspaceName: string | null; trialEndsLabel: string; daysLeft: number; keptUntilLabel: string; billingUrl: string; boardUrl?: string }): Promise<SendEmailResult> {
    const subject = translatorFor(recipient)('subjects.trialEnding', { daysLeft: input.daysLeft })
    return deliver(recipient, 'trial_ending_3d', subject, React.createElement(TrialEnding, { ...input, ...frameOf(recipient) }))
}

export function sendTrialFinalNoticeEmail(
    recipient: Recipient,
    input: { hasCard: boolean; workspaceName: string | null; trialEndsLabel: string; pausedLabel: string; keptUntilLabel: string; billingUrl: string; boardUrl?: string },
): Promise<SendEmailResult> {
    const t = translatorFor(recipient)
    const subject = input.hasCard ? t('subjects.trialFinalNoticeCard') : t('subjects.trialFinalNoticeNoCard')
    return deliver(recipient, 'trial_ending_2h', subject, React.createElement(TrialFinalNotice, { ...input, ...frameOf(recipient) }))
}

export function sendTrialEndedEmail(
    recipient: Recipient,
    input: { reason: TrialEndedReason; workspaceName: string | null; trialEndedLabel: string; pausedLabel: string; keptUntilLabel: string; summary?: TrialSummary; billingUrl: string; boardUrl?: string },
): Promise<SendEmailResult> {
    // The deadline belongs in the subject: this is the one email in the set whose whole point is a
    // date, and an inbox that shows only subject lines has to carry it.
    const t = translatorFor(recipient)
    const subject = input.reason === 'payment_failed' ? t('subjects.trialEndedPaymentFailed') : t('subjects.trialEndedNoCard')
    return deliver(recipient, 'trial_ended', subject, React.createElement(TrialEnded, { ...input, ...frameOf(recipient) }))
}

export function sendPaymentFailedEmail(
    recipient: Recipient,
    input: { workspaceName: string | null; amountLabel?: string; pausedLabel: string; firstCharge?: boolean; billingUrl: string; boardUrl?: string },
): Promise<SendEmailResult> {
    return deliver(recipient, 'payment_failed', translatorFor(recipient)('subjects.paymentFailed'), React.createElement(PaymentFailed, { ...input, ...frameOf(recipient) }))
}

// One email for the three rungs of the cancellation ladder, so the rung it was sent for has to
// travel with it: the sender domain and the log line are read from it.
export function sendSubscriptionEndingEmail(
    recipient: Recipient,
    key: LifecycleSequenceKey,
    input: { workspaceName: string | null; endsLabel: string; daysLeft: number; keptUntilLabel: string; billingUrl: string; boardUrl?: string },
): Promise<SendEmailResult> {
    const subject = translatorFor(recipient)('subjects.subscriptionEnding', { daysLeft: Math.max(input.daysLeft, 1) })
    return deliver(recipient, key, subject, React.createElement(SubscriptionEnding, { ...input, ...frameOf(recipient) }))
}

export function sendArchiveExpiringEmail(
    recipient: Recipient,
    input: { workspaceName: string | null; pausedLabel: string; deletionLabel: string; agentCount: number; billingUrl: string; sandbox?: boolean; boardUrl?: string },
): Promise<SendEmailResult> {
    const subject = translatorFor(recipient)('subjects.archiveExpiring', { kind: input.sandbox ? 'sandbox' : 'workspace', date: input.deletionLabel })
    return deliver(recipient, 'workspace_archive_expiring', subject, React.createElement(ArchiveExpiring, { ...input, ...frameOf(recipient) }))
}

export function sendSandboxIdleEmail(recipient: Recipient, input: { lastActiveLabel: string; archiveLabel: string; agentCount: number; sandboxUrl: string; boardUrl?: string }): Promise<SendEmailResult> {
    return deliver(recipient, 'sandbox_idle_warning', translatorFor(recipient)('subjects.sandboxIdle', { date: input.archiveLabel }), React.createElement(SandboxIdle, { ...input, ...frameOf(recipient) }))
}

export function sendRenewalReminderEmail(
    recipient: Recipient,
    input: { workspaceName: string | null; renewsLabel: string; daysLeft: number; amountLabel?: string; billingUrl: string; boardUrl?: string },
): Promise<SendEmailResult> {
    const subject = translatorFor(recipient)('subjects.renewalReminder', { daysLeft: Math.max(input.daysLeft, 1) })
    return deliver(recipient, 'renewal_reminder_7d', subject, React.createElement(RenewalReminder, { ...input, ...frameOf(recipient) }))
}

export function sendCreatorPitchEmail(recipient: Recipient, input: { firstName: string | null; agentName: string | null; creatorUrl: string }): Promise<SendEmailResult> {
    return deliver(recipient, 'creator_pitch', translatorFor(recipient)('subjects.creatorPitch'), React.createElement(CreatorPitch, { ...input, ...frameOf(recipient) }))
}
