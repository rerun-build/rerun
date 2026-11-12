import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureServer } from '@rerun/analytics/server'
import { stripe } from '@/ee/lib/billing/stripe'
import { emailBoardBanner } from '@/lib/email/board-banner'
import * as emails from '@/ee/lib/email/lifecycle-emails'
import { RETRIABLE_MARKER } from '@/lib/email/throttle'
import { fakeSupabase } from '@/test/supabase-fake'
import type { LifecycleCandidate, LifecycleSnapshot } from './decide'
import type { UserRow, WorkspaceRow } from './discovery'
import { loadRecipient } from './recipient'
import { deliverLifecycleEmail, type DeliverInput } from './send'
import type { LifecycleSequenceKey } from './sequences'
import { LIFECYCLE_SEQUENCES } from './sequences'
import { recordLifecycleEmail } from './store'

const { BANNER } = vi.hoisted(() => ({ BANNER: 'https://app.rerun.build/og/board?sig=banner' }))

vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({ ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()), stripe: (await import('@/ee/test/stripe-fake')).fakeStripe() }))
vi.mock('@rerun/analytics/server', () => ({ captureServer: vi.fn().mockResolvedValue(undefined), deterministicUuid: (seed: string) => `uuid:${seed}` }))
vi.mock('@/ee/lib/email/lifecycle-emails', () => ({
    sendAgentIdleEmail: vi.fn(),
    sendAgentRecommendationsEmail: vi.fn(),
    sendArchiveExpiringEmail: vi.fn(),
    sendAutomateAgentEmail: vi.fn(),
    sendCreatorPitchEmail: vi.fn(),
    sendOnboardingResumeEmail: vi.fn(),
    sendRenewalReminderEmail: vi.fn(),
    sendSubscriptionEndingEmail: vi.fn(),
    sendTeamInviteEmail: vi.fn(),
    sendTrialEndedEmail: vi.fn(),
    sendTrialEndingEmail: vi.fn(),
    sendTrialFinalNoticeEmail: vi.fn(),
}))
vi.mock('@/lib/templates/email-card', () => ({ warmTemplateEmailCards: vi.fn() }))
vi.mock('@/lib/templates/recommend', () => ({ loadRecommendCandidates: vi.fn(), recommendTemplates: vi.fn() }))
vi.mock('./recipient', () => ({ loadRecipient: vi.fn() }))
vi.mock('@/lib/email/board-banner', () => ({ BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: vi.fn(async () => BANNER) }))
vi.mock('./store', () => ({ recordLifecycleEmail: vi.fn() }))

const NOW = new Date('2026-09-20T12:00:00.000Z')
const HOUR = 60 * 60_000

const SEND_FNS = Object.values(emails).filter(value => typeof value === 'function') as ReturnType<typeof vi.fn>[]

function candidate(sequenceKey: LifecycleSequenceKey, overrides: Partial<LifecycleCandidate> = {}): LifecycleCandidate {
    return { sequenceKey, userId: 'user-1', workspaceId: 1, agentId: null, agentName: null, category: LIFECYCLE_SEQUENCES[sequenceKey].category, urgent: LIFECYCLE_SEQUENCES[sequenceKey].urgent, ...overrides }
}

function snapshot(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
    return {
        userId: 'user-1',
        workspaceId: 1,
        isFounder: true,
        isSandbox: false,
        signedUpAt: null,
        onboardingCompletedAt: null,
        trialEndsAt: null,
        subscriptionEntitled: true,
        trialLapsed: false,
        trialPaymentFailed: false,
        subscriptionPaid: false,
        subscriptionCancelAt: null,
        boxesArchivedAt: null,
        pausedArchive: null,
        renewalReminderAt: null,
        memberCount: 1,
        agentCount: 0,
        firstSuccessfulRunAt: null,
        successfulRuns: 0,
        idleAgents: [],
        habitAgents: [],
        recommendationCount: 0,
        sent: [],
        wantsProduct: true,
        wantsBilling: true,
        ...overrides,
    }
}

const user: UserRow = { id: 'user-1', workspace_id: 1, signed_up_at: null, email_notification_prefs: null }
const workspace: WorkspaceRow = {
    id: 1,
    name: 'Acme',
    is_sandbox: false,
    trial_ends_at: null,
    subscription_status: 'trialing',
    subscription_cancel_at: null,
    payment_failed_at: null,
    first_paid_at: null,
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    current_period_end: null,
    onboarded_at: null,
    renewal_reminder_at: null,
    renewal_reminder_user_id: null,
    boxes_archived_at: null,
    billing_provider: 'stripe',
    onboarding_answers: null,
}

function input(sequenceKey: LifecycleSequenceKey, overrides: { candidate?: Partial<LifecycleCandidate>; snapshot?: Partial<LifecycleSnapshot>; workspace?: Partial<WorkspaceRow> } = {}): DeliverInput {
    return { candidate: candidate(sequenceKey, overrides.candidate), snapshot: snapshot(overrides.snapshot), user, workspace: { ...workspace, ...overrides.workspace }, agentName: null, now: NOW }
}

function deliver(value: DeliverInput) {
    return deliverLifecycleEmail(fakeSupabase().client, value)
}

describe('deliverLifecycleEmail', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubEnv('UNSUBSCRIBE_SECRET', 'secret')
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(loadRecipient).mockResolvedValue({ email: 'ada@example.com', firstName: 'Ada' })
        vi.mocked(recordLifecycleEmail).mockResolvedValue('recorded')
        for (const send of SEND_FNS) send.mockResolvedValue({ ok: true, id: 'email_1' })
    })
    afterEach(() => vi.unstubAllEnvs())

    it('sends, records and reports the send', async () => {
        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: true })

        expect(emails.sendOnboardingResumeEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@example.com' }), expect.objectContaining({ firstName: 'Ada' }))
        expect(recordLifecycleEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sequenceKey: 'onboarding_resume' }), 'sent', { emailId: 'email_1' })
        expect(captureServer).toHaveBeenCalledWith('ada@example.com', 'lifecycle_email_sent', { sequence: 'onboarding_resume', category: 'product' }, { uuid: 'uuid:lifecycle_email_sent:email_1' })
    })

    it('does nothing for an account without an address', async () => {
        vi.mocked(loadRecipient).mockResolvedValue(null)

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: false, reason: 'no address' })
        expect(recordLifecycleEmail).not.toHaveBeenCalled()
    })

    it('records nothing on a retriable failure, so the next tick tries again', async () => {
        vi.mocked(emails.sendOnboardingResumeEmail).mockResolvedValue({ ok: false, error: `${RETRIABLE_MARKER}slow down` })

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: false, reason: `${RETRIABLE_MARKER}slow down` })
        expect(recordLifecycleEmail).not.toHaveBeenCalled()
    })

    it('records a failed row on a permanent failure, which keeps the slot', async () => {
        vi.mocked(emails.sendOnboardingResumeEmail).mockResolvedValue({ ok: false, error: 'rejected: bad address' })

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: false, reason: 'rejected: bad address' })
        expect(recordLifecycleEmail).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'failed', { error: 'rejected: bad address' })
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('records nothing when Resend is not configured', async () => {
        vi.mocked(emails.sendOnboardingResumeEmail).mockResolvedValue({ ok: true, id: null, skipped: true })

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: false, reason: 'no Resend key' })
        expect(recordLifecycleEmail).not.toHaveBeenCalled()
    })

    it('reports a send another tick already recorded as not sent', async () => {
        vi.mocked(recordLifecycleEmail).mockResolvedValue('duplicate')

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: false, reason: 'already recorded' })
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('still reports the send when analytics fails', async () => {
        vi.mocked(captureServer).mockRejectedValueOnce(new Error('posthog down'))

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: true })
    })

    it('does not report sent when recording the send keeps failing, since the next tick re-sends it', async () => {
        vi.mocked(recordLifecycleEmail).mockResolvedValue('failed')

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: false, reason: 'delivered but not recorded, the next sweep may send it again' })
        expect(recordLifecycleEmail).toHaveBeenCalledTimes(2)
        expect(captureServer).toHaveBeenCalledOnce()
    })

    it('records the send on the second try after a passing failure', async () => {
        vi.mocked(recordLifecycleEmail).mockResolvedValueOnce('failed').mockResolvedValueOnce('recorded')

        await expect(deliver(input('onboarding_resume'))).resolves.toEqual({ sent: true })
        expect(recordLifecycleEmail).toHaveBeenCalledTimes(2)
    })

    describe('skips', () => {
        it('drops a trial countdown once the trial is over', async () => {
            const over = { snapshot: { trialEndsAt: new Date(NOW.getTime() - HOUR) } }

            await expect(deliver(input('trial_ending_3d', over))).resolves.toEqual({ sent: false, reason: 'trial already over' })
            await expect(deliver(input('trial_ending_2h', over))).resolves.toEqual({ sent: false, reason: 'trial already over' })
            expect(emails.sendTrialEndingEmail).not.toHaveBeenCalled()
            expect(emails.sendTrialFinalNoticeEmail).not.toHaveBeenCalled()
            expect(recordLifecycleEmail).not.toHaveBeenCalled()
        })

        it('drops a trial email for a workspace without a trial', async () => {
            await expect(deliver(input('trial_ending_3d'))).resolves.toEqual({ sent: false, reason: 'no trial' })
            await expect(deliver(input('trial_ended'))).resolves.toEqual({ sent: false, reason: 'no trial' })
        })

        it('drops a subscription countdown whose cancellation was withdrawn', async () => {
            await expect(deliver(input('subscription_ending_3d'))).resolves.toEqual({ sent: false, reason: 'cancellation withdrawn' })
            expect(emails.sendSubscriptionEndingEmail).not.toHaveBeenCalled()
        })

        it('drops a renewal reminder once the plan no longer renews', async () => {
            const renewing = { workspace: { current_period_end: new Date(NOW.getTime() + 7 * 24 * HOUR).toISOString() } }

            await expect(deliver(input('renewal_reminder_7d', { ...renewing, snapshot: { subscriptionPaid: true, subscriptionCancelAt: new Date(NOW.getTime() + 7 * 24 * HOUR) } }))).resolves.toEqual({ sent: false, reason: 'no longer renewing' })
            await expect(deliver(input('renewal_reminder_7d', { ...renewing, snapshot: { subscriptionPaid: false } }))).resolves.toEqual({ sent: false, reason: 'no longer renewing' })
            expect(emails.sendRenewalReminderEmail).not.toHaveBeenCalled()
        })

        it('drops the idle nudge when the agent has run since', async () => {
            await expect(deliver(input('agent_idle', { candidate: { agentId: 'agent-1' } }))).resolves.toEqual({ sent: false, reason: 'coworker no longer idle' })
            expect(emails.sendAgentIdleEmail).not.toHaveBeenCalled()
            expect(emailBoardBanner).not.toHaveBeenCalled()
        })

        it('drops the automation nudge when the agent is no longer run by hand', async () => {
            await expect(deliver(input('automate_agent', { candidate: { agentId: 'agent-1' } }))).resolves.toEqual({ sent: false, reason: 'coworker no longer runs by hand' })
        })

        it('drops the archive expiry notice for a workspace no longer paused', async () => {
            await expect(deliver(input('workspace_archive_expiring'))).resolves.toEqual({ sent: false, reason: 'not paused' })
            expect(emails.sendArchiveExpiringEmail).not.toHaveBeenCalled()
        })

        it('never sends the trial receipt from the sweeper', async () => {
            await expect(deliver(input('trial_started'))).resolves.toEqual({ sent: false, reason: 'sent inline, never from the sweeper' })
        })
    })

    describe('unsubscribe link', () => {
        it('leaves it out of a mandatory end-of-access notice', async () => {
            await deliver(input('trial_ending_3d', { snapshot: { trialEndsAt: new Date(NOW.getTime() + 20 * HOUR) } }))

            expect(emails.sendTrialEndingEmail).toHaveBeenCalledWith({ to: 'ada@example.com', unsubscribeUrl: null, locale: 'en' }, expect.objectContaining({ daysLeft: 1 }))
        })

        it('scopes it to the category of an optional email', async () => {
            await deliver(input('onboarding_resume'))

            const [recipient] = vi.mocked(emails.sendOnboardingResumeEmail).mock.calls[0]
            expect(recipient.unsubscribeUrl).toMatch(/&category=product$/)
        })
    })

    it('writes to an account in the language it picked, dates included', async () => {
        const db = fakeSupabase(table => (table === 'users' ? { data: { locale: 'fr' } } : undefined))
        await deliverLifecycleEmail(db.client, input('trial_ending_3d', { snapshot: { trialEndsAt: new Date(NOW.getTime() + 20 * HOUR) } }))

        expect(emails.sendTrialEndingEmail).toHaveBeenCalledWith({ to: 'ada@example.com', unsubscribeUrl: null, locale: 'fr' }, expect.objectContaining({ trialEndsLabel: '21 septembre' }))
    })

    it('sends the idle nudge for an agent that is still idle', async () => {
        const at = new Date(NOW.getTime() - 26 * HOUR)

        await expect(deliver(input('agent_idle', { candidate: { agentId: 'agent-1' }, snapshot: { idleAgents: [{ id: 'agent-1', name: 'Scout', at }] } }))).resolves.toEqual({ sent: true })
        expect(emails.sendAgentIdleEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agentName: 'Scout', createdLabel: 'yesterday', boardUrl: BANNER }))
        expect(emailBoardBanner).toHaveBeenCalledWith(expect.anything(), 1, { 'agent-1': 'idle' }, expect.any(Number))
    })

    it('links the open invoice when the first charge was declined', async () => {
        vi.mocked(stripe.invoices.list).mockResolvedValue({ data: [{ hosted_invoice_url: 'https://pay.stripe.test/in_1' }] } as never)

        await deliver(input('trial_ended', { snapshot: { trialEndsAt: new Date(NOW.getTime() - HOUR), trialPaymentFailed: true } }))

        expect(emails.sendTrialEndedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'payment_failed', billingUrl: 'https://pay.stripe.test/in_1' }))
    })

    it('gives a declined first charge the day the teardown counts, from the charge and not from the send', async () => {
        const declinedAt = new Date(NOW.getTime() - HOUR).toISOString()

        await deliver(input('trial_ended', { snapshot: { trialEndsAt: new Date(NOW.getTime() - 2 * HOUR), trialPaymentFailed: true }, workspace: { payment_failed_at: declinedAt } }))

        expect(emails.sendTrialEndedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pausedLabel: '21 September, 11:00 UTC' }))
    })

    it('measures the days left on a subscription countdown instead of reading the rung name', async () => {
        await deliver(input('subscription_ending_7d', { snapshot: { subscriptionCancelAt: new Date(NOW.getTime() + 5 * 24 * HOUR) } }))

        expect(emails.sendSubscriptionEndingEmail).toHaveBeenCalledWith(expect.anything(), 'subscription_ending_7d', expect.objectContaining({ daysLeft: 5 }))
    })

    it('dates the archive expiry notice from the archive itself', async () => {
        const archivedAt = new Date('2026-06-24T09:30:00.000Z')
        const pausedArchive = { archivedAt, expiresAt: new Date('2026-09-22T09:30:00.000Z') }

        await deliver(input('workspace_archive_expiring', { snapshot: { boxesArchivedAt: archivedAt, pausedArchive, agentCount: 3 } }))

        expect(emails.sendArchiveExpiringEmail).toHaveBeenCalledWith(
            { to: 'ada@example.com', unsubscribeUrl: null, locale: 'en' },
            { workspaceName: 'Acme', pausedLabel: '24 June', deletionLabel: '22 September', agentCount: 3, billingUrl: expect.stringMatching(/\/\?billing=1$/), boardUrl: BANNER },
        )
        expect(emailBoardBanner).toHaveBeenCalledWith(expect.anything(), 1, 'offline', expect.any(Number))
    })

    it('tells a lapsed trial when it is paused and until when it is saved', async () => {
        await deliver(input('trial_ended', { snapshot: { trialEndsAt: new Date(NOW.getTime() - HOUR) } }))

        expect(emails.sendTrialEndedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pausedLabel: '20 September, 14:00 UTC', keptUntilLabel: '19 December' }))
    })

    it('quotes the renewal date and the amount Stripe will charge', async () => {
        vi.mocked(stripe.invoices.createPreview).mockResolvedValue({ amount_due: 5880, currency: 'usd' } as never)

        await deliver(input('renewal_reminder_7d', { snapshot: { subscriptionPaid: true }, workspace: { current_period_end: '2026-09-27T12:00:00.000Z' } }))

        expect(stripe.invoices.createPreview).toHaveBeenCalledWith({ subscription: 'sub_1' })
        expect(emails.sendRenewalReminderEmail).toHaveBeenCalledWith({ to: 'ada@example.com', unsubscribeUrl: null, locale: 'en' }, expect.objectContaining({ renewsLabel: '27 September', daysLeft: 7, amountLabel: '$58.80' }))
    })

    it('still sends the renewal reminder when Stripe cannot quote the amount', async () => {
        vi.mocked(stripe.invoices.createPreview).mockRejectedValue(new Error('stripe down'))

        await deliver(input('renewal_reminder_7d', { snapshot: { subscriptionPaid: true }, workspace: { current_period_end: '2026-09-27T12:00:00.000Z' } }))

        expect(emails.sendRenewalReminderEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amountLabel: undefined }))
    })

    it('sends the no-card final notice when Stripe cannot be read', async () => {
        vi.mocked(stripe.customers.retrieve).mockRejectedValue(new Error('stripe down'))

        await deliver(input('trial_ending_2h', { snapshot: { trialEndsAt: new Date(NOW.getTime() + HOUR) } }))

        expect(emails.sendTrialFinalNoticeEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hasCard: false }))
    })
})
