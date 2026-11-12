import { describe, expect, it, vi } from 'vitest'
import { pickLifecycleEmail, type LifecycleSnapshot } from './decide'
import type * as Sequences from './sequences'

// The activation group is paused, not removed: these cases keep pinning how it behaves once it is
// switched back on.
vi.mock('./sequences', async importOriginal => {
    const actual = await importOriginal<typeof Sequences>()
    const LIFECYCLE_LADDER = actual.LIFECYCLE_SEQUENCE_KEYS.filter(key => key !== 'trial_started' && (!actual.PAUSED_LIFECYCLE_SEQUENCES.has(key) || actual.ACTIVATION_SEQUENCES.has(key))).sort(
        (a, b) => actual.LIFECYCLE_SEQUENCES[a].rank - actual.LIFECYCLE_SEQUENCES[b].rank,
    )
    return { ...actual, LIFECYCLE_LADDER }
})

const NOW = new Date('2026-09-03T12:00:00.000Z')
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

function ago(ms: number): Date {
    return new Date(NOW.getTime() - ms)
}

function ahead(ms: number): Date {
    return new Date(NOW.getTime() + ms)
}

function snapshot(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
    return {
        userId: 'user-1',
        workspaceId: 1,
        isFounder: true,
        isSandbox: false,
        signedUpAt: ago(30 * HOUR),
        onboardingCompletedAt: ago(30 * HOUR),
        trialEndsAt: ahead(5 * DAY),
        subscriptionEntitled: true,
        trialLapsed: false,
        trialPaymentFailed: false,
        subscriptionPaid: false,
        subscriptionCancelAt: null,
        boxesArchivedAt: null,
        pausedArchive: null,
        renewalReminderAt: null,
        memberCount: 2,
        agentCount: 1,
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

function sent(sequenceKey: LifecycleSnapshot['sent'][number]['sequenceKey'], overrides: Partial<LifecycleSnapshot['sent'][number]> = {}) {
    return { sequenceKey, agentId: null, sentAt: ago(30 * DAY), recipientId: 'user-1', ...overrides }
}

describe('pickLifecycleEmail for a store subscription', () => {
    const NOW = new Date('2026-11-12T10:00:00Z')
    const DAY = 86_400_000

    it('leaves the trial countdown to the store, which reminds before its own charge', () => {
        const trialing = snapshot({ trialEndsAt: new Date(NOW.getTime() + DAY), subscriptionEntitled: true, subscriptionPaid: false, wantsBilling: true })
        expect(pickLifecycleEmail(trialing, NOW)?.sequenceKey).toBe('trial_ending_3d')
        expect(pickLifecycleEmail({ ...trialing, storeBilled: true }, NOW)).toBeNull()
    })

    it('leaves the cancellation countdown to the store, where it is resumed', () => {
        const ending = snapshot({ subscriptionEntitled: true, subscriptionPaid: true, subscriptionCancelAt: new Date(NOW.getTime() + 12 * 3_600_000) })
        expect(pickLifecycleEmail(ending, NOW)?.sequenceKey).toBe('subscription_ending_24h')
        expect(pickLifecycleEmail({ ...ending, storeBilled: true }, NOW)).toBeNull()
    })

    it('still says the trial ended, which the teardown counts its grace from', () => {
        const lapsed = snapshot({ trialEndsAt: new Date(NOW.getTime() - 3_600_000), subscriptionEntitled: false, trialLapsed: true, storeBilled: true })
        expect(pickLifecycleEmail(lapsed, NOW)?.sequenceKey).toBe('trial_ended')
    })
})

describe('pickLifecycleEmail', () => {
    it('picks the activation email highest on the ladder', () => {
        const activation = snapshot({
            onboardingCompletedAt: null,
            agentCount: 0,
            recommendationCount: 3,
            idleAgents: [{ id: 'agent-1', name: 'Atlas', at: ago(DAY + HOUR) }],
        })

        expect(pickLifecycleEmail(activation, NOW)?.sequenceKey).toBe('agent_idle')
        expect(pickLifecycleEmail({ ...activation, idleAgents: [] }, NOW)?.sequenceKey).toBe('onboarding_resume')
        expect(pickLifecycleEmail({ ...activation, idleAgents: [], onboardingCompletedAt: ago(30 * HOUR) }, NOW)?.sequenceKey).toBe('agent_recommendations')
    })

    it('leaves the onboarding emails to the founder of the workspace', () => {
        const member = snapshot({ isFounder: false, onboardingCompletedAt: null, agentCount: 0, recommendationCount: 3 })
        expect(pickLifecycleEmail(member, NOW)).toBeNull()
        expect(pickLifecycleEmail({ ...member, onboardingCompletedAt: ago(30 * HOUR) }, NOW)).toBeNull()
    })

    it('sends nothing rather than a thin recommendation list', () => {
        const thin = snapshot({ agentCount: 0, recommendationCount: 1 })
        expect(pickLifecycleEmail(thin, NOW)).toBeNull()
    })

    it('caps non-urgent emails at one a day', () => {
        const eligible = snapshot({ onboardingCompletedAt: null, sent: [sent('trial_started', { sentAt: ago(DAY - HOUR) })] })
        expect(pickLifecycleEmail(eligible, NOW)).toBeNull()

        const yesterday = { ...eligible, sent: [sent('trial_started', { sentAt: ago(DAY + HOUR) })] }
        expect(pickLifecycleEmail(yesterday, NOW)?.sequenceKey).toBe('onboarding_resume')
    })

    it('lets a colleague keep their own day', () => {
        const colleagueGotIt = snapshot({
            onboardingCompletedAt: null,
            sent: [sent('trial_ending_3d', { sentAt: ago(HOUR), recipientId: 'user-2' })],
        })
        expect(pickLifecycleEmail(colleagueGotIt, NOW)?.sequenceKey).toBe('onboarding_resume')
    })

    it('lets the end of a trial through the cap and past an eligible activation email', () => {
        const trialOver = snapshot({
            trialEndsAt: ago(HOUR),
            subscriptionEntitled: false,
            trialLapsed: true,
            onboardingCompletedAt: null,
            idleAgents: [{ id: 'agent-1', name: 'Atlas', at: ago(4 * HOUR) }],
            sent: [sent('agent_idle', { sentAt: ago(HOUR), agentId: 'agent-9' })],
        })
        expect(pickLifecycleEmail(trialOver, NOW)?.sequenceKey).toBe('trial_ended')
    })

    // A muted rung hands over to the one below rather than ending the pass. Muting billing is the
    // asymmetric case: every billing rung left in the ladder is an end-of-access notice, and those
    // ignore the preference entirely (see 'the end-of-access rungs' below).
    it('hands over to the rung below a muted category', () => {
        const both = snapshot({
            trialEndsAt: ago(HOUR),
            subscriptionEntitled: false,
            trialLapsed: true,
            onboardingCompletedAt: null,
            idleAgents: [{ id: 'agent-1', name: 'Atlas', at: ago(DAY + HOUR) }],
        })

        expect(pickLifecycleEmail({ ...both, wantsProduct: false }, NOW)?.sequenceKey).toBe('trial_ended')
        expect(pickLifecycleEmail({ ...both, sent: [sent('trial_ended')], wantsProduct: false }, NOW)).toBeNull()
        expect(pickLifecycleEmail({ ...both, sent: [sent('trial_ended')] }, NOW)?.sequenceKey).toBe('agent_idle')
    })

    it('sends one activation reminder per person, ever', () => {
        const twoIdle = snapshot({
            agentCount: 0,
            recommendationCount: 3,
            idleAgents: [
                { id: 'agent-1', name: 'Atlas', at: ago(DAY + 2 * HOUR) },
                { id: 'agent-2', name: 'Vega', at: ago(DAY + HOUR) },
            ],
        })
        expect(pickLifecycleEmail({ ...twoIdle, sent: [sent('agent_idle', { agentId: 'agent-1' })] }, NOW)).toBeNull()
        expect(pickLifecycleEmail({ ...twoIdle, idleAgents: [], sent: [sent('onboarding_resume')] }, NOW)).toBeNull()

        const colleagueReminded = pickLifecycleEmail({ ...twoIdle, sent: [sent('agent_idle', { agentId: 'agent-1', recipientId: 'user-2' })] }, NOW)
        expect(colleagueReminded?.agentId).toBe('agent-2')
    })

    it('never repeats a workspace-scoped email', () => {
        const reminded = snapshot({ trialEndsAt: ahead(12 * HOUR), sent: [sent('trial_ending_3d')] })
        expect(pickLifecycleEmail(reminded, NOW)).toBeNull()
    })

    it('never sends a paused sequence', () => {
        const soloAfterFirstRun = snapshot({ memberCount: 1, firstSuccessfulRunAt: ago(2 * HOUR), trialEndsAt: null })
        expect(pickLifecycleEmail(soloAfterFirstRun, NOW)).toBeNull()

        const runByHand = snapshot({ habitAgents: [{ id: 'agent-1', name: 'Atlas', at: ago(3 * DAY) }] })
        expect(pickLifecycleEmail(runByHand, NOW)).toBeNull()

        const trialLongOver = snapshot({ trialEndsAt: ago(4 * DAY), subscriptionEntitled: true })
        expect(pickLifecycleEmail(trialLongOver, NOW)).toBeNull()
    })

    it('holds an activation email until the fact has settled, and drops it once stale', () => {
        const tooFresh = snapshot({ onboardingCompletedAt: null, signedUpAt: ago(20 * HOUR) })
        expect(pickLifecycleEmail(tooFresh, NOW)).toBeNull()

        const stale = snapshot({ onboardingCompletedAt: null, signedUpAt: ago(3 * DAY) })
        expect(pickLifecycleEmail(stale, NOW)).toBeNull()
    })

    it('never emails a sandbox workspace', () => {
        const sandbox = snapshot({ isSandbox: true, onboardingCompletedAt: null, trialEndsAt: ago(HOUR), subscriptionEntitled: false, trialLapsed: true })
        expect(pickLifecycleEmail(sandbox, NOW)).toBeNull()
    })

    it('picks the same agent on a retry when two were created together', () => {
        const twins = snapshot({
            idleAgents: [
                { id: 'agent-b', name: 'Vega', at: ago(DAY + HOUR) },
                { id: 'agent-a', name: 'Atlas', at: ago(DAY + HOUR) },
            ],
        })
        expect(pickLifecycleEmail(twins, NOW)?.agentId).toBe('agent-a')
    })
})

describe('the end-of-access rungs', () => {
    const paying = { subscriptionEntitled: true, subscriptionPaid: true, trialEndsAt: ago(90 * DAY) }

    it('walks the countdown one rung at a time', () => {
        const endsIn = (ms: number) => snapshot({ ...paying, subscriptionCancelAt: ahead(ms) })

        expect(pickLifecycleEmail(endsIn(8 * DAY), NOW)).toBeNull()
        expect(pickLifecycleEmail(endsIn(5 * DAY), NOW)?.sequenceKey).toBe('subscription_ending_7d')
        expect(pickLifecycleEmail(endsIn(2 * DAY), NOW)?.sequenceKey).toBe('subscription_ending_3d')
        expect(pickLifecycleEmail(endsIn(12 * HOUR), NOW)?.sequenceKey).toBe('subscription_ending_24h')
    })

    // A cancellation scheduled at the last minute must not replay the whole ladder: the two wider
    // rungs have already gone stale by the time their deadline arrives.
    it('sends only the last reminder when the cancellation lands late', () => {
        const late = snapshot({ ...paying, subscriptionCancelAt: ahead(6 * HOUR) })
        expect(pickLifecycleEmail(late, NOW)?.sequenceKey).toBe('subscription_ending_24h')
        expect(pickLifecycleEmail({ ...late, sent: [sent('subscription_ending_24h')] }, NOW)).toBeNull()
    })

    it('says nothing when the subscription renews', () => {
        expect(pickLifecycleEmail(snapshot({ ...paying, subscriptionCancelAt: null }), NOW)).toBeNull()
    })

    // A cancelled trial is never charged: telling it its plan starts in two hours is false, and the
    // subscription countdown is for paid plans only. It hears once, when the trial is over.
    it('says nothing to a cancelled trial until it ends', () => {
        const cancelled = (endsIn: number) => snapshot({ subscriptionPaid: false, subscriptionCancelAt: ahead(endsIn), trialEndsAt: ahead(endsIn) })
        expect(pickLifecycleEmail(cancelled(12 * HOUR), NOW)).toBeNull()
        expect(pickLifecycleEmail(cancelled(HOUR), NOW)).toBeNull()

        const endedOnTheSpot = snapshot({ subscriptionEntitled: false, trialLapsed: true, trialEndsAt: ahead(12 * HOUR) })
        expect(pickLifecycleEmail(endedOnTheSpot, NOW)).toBeNull()

        const over = snapshot({ subscriptionEntitled: false, trialLapsed: true, subscriptionCancelAt: ago(HOUR), trialEndsAt: ago(HOUR) })
        expect(pickLifecycleEmail(over, NOW)?.sequenceKey).toBe('trial_ended')
    })

    it('warns again once the cancellation is withdrawn', () => {
        const resumed = snapshot({ subscriptionCancelAt: null, trialEndsAt: ahead(12 * HOUR) })
        expect(pickLifecycleEmail(resumed, NOW)?.sequenceKey).toBe('trial_ending_3d')
    })

    // Workspace 11306 in production: trial started 2026-10-05 19:09:55 UTC and cancelled 72 seconds
    // later, so Stripe set `cancel_at` to the trial end. It still got both reminders, the second one
    // telling it the card on file was about to be charged.
    describe('a trial cancelled 72 seconds after it started (workspace 11306)', () => {
        const trialEndsAt = new Date('2026-10-08T19:09:55.000Z')
        const cancelledTrial = (sentSoFar: LifecycleSnapshot['sent'] = []) =>
            snapshot({ workspaceId: 11306, subscriptionEntitled: true, subscriptionPaid: false, trialLapsed: false, trialEndsAt, subscriptionCancelAt: trialEndsAt, sent: sentSoFar })

        it('sends no « trial ends tomorrow » at the 2026-10-07 19:15 tick', () => {
            expect(pickLifecycleEmail(cancelledTrial(), new Date('2026-10-07T19:15:32.000Z'))).toBeNull()
        })

        it('sends no « your plan starts in 2 hours » at the 2026-10-08 17:15 tick', () => {
            expect(pickLifecycleEmail(cancelledTrial(), new Date('2026-10-08T17:15:38.000Z'))).toBeNull()
        })
    })

    it('warns a day before the trial ends, then two hours before, then hands over', () => {
        expect(pickLifecycleEmail(snapshot({ trialEndsAt: ahead(2 * DAY) }), NOW)).toBeNull()
        expect(pickLifecycleEmail(snapshot({ trialEndsAt: ahead(12 * HOUR) }), NOW)?.sequenceKey).toBe('trial_ending_3d')
        expect(pickLifecycleEmail(snapshot({ trialEndsAt: ahead(3 * HOUR) }), NOW)?.sequenceKey).toBe('trial_ending_3d')
        expect(pickLifecycleEmail(snapshot({ trialEndsAt: ahead(90 * 60_000) }), NOW)?.sequenceKey).toBe('trial_ending_2h')

        const over = snapshot({ trialEndsAt: ago(2 * HOUR), subscriptionEntitled: false, trialLapsed: true })
        expect(pickLifecycleEmail(over, NOW)?.sequenceKey).toBe('trial_ended')
    })

    // A reminder missed in its window is not replayed on top of the two-hour notice.
    it('sends only the two-hour notice in the last two hours', () => {
        const lastHours = snapshot({ trialEndsAt: ahead(HOUR) })
        expect(pickLifecycleEmail(lastHours, NOW)?.sequenceKey).toBe('trial_ending_2h')
        expect(pickLifecycleEmail({ ...lastHours, sent: [sent('trial_ending_2h')] }, NOW)).toBeNull()
    })

    it('says nothing two hours out to a trial already converted', () => {
        expect(pickLifecycleEmail(snapshot({ trialEndsAt: ahead(HOUR), subscriptionPaid: true }), NOW)).toBeNull()
    })

    // Right after the deadline a card-backed trial reads `active` with nothing paid while Stripe
    // prepares the first charge. It has not lapsed, and must not be told its workspace is going.
    it('waits for the first charge before calling a trial over', () => {
        const charging = snapshot({ trialEndsAt: ago(HOUR), subscriptionEntitled: true, subscriptionPaid: true })
        expect(pickLifecycleEmail(charging, NOW)).toBeNull()

        const declined = snapshot({ trialEndsAt: ago(2 * HOUR), subscriptionEntitled: true, subscriptionPaid: true, trialLapsed: true, trialPaymentFailed: true })
        expect(pickLifecycleEmail(declined, NOW)?.sequenceKey).toBe('trial_ended')
    })

    // They announce that a machine is about to be switched off. No email preference reads as
    // declining that, and the daily cap does not get to hold one back either.
    it('ignores the category opt-out and the daily cap', () => {
        const muted = snapshot({
            ...paying,
            subscriptionCancelAt: ahead(12 * HOUR),
            wantsBilling: false,
            wantsProduct: false,
            sent: [sent('agent_idle', { sentAt: ago(HOUR) })],
        })
        expect(pickLifecycleEmail(muted, NOW)?.sequenceKey).toBe('subscription_ending_24h')
    })

    it('only ever talks to the founder', () => {
        const member = snapshot({ ...paying, subscriptionCancelAt: ahead(12 * HOUR), isFounder: false })
        expect(pickLifecycleEmail(member, NOW)).toBeNull()
    })
})

describe('the archive expiry notice', () => {
    const archivedAt = ago(85 * DAY)

    // Paused after its trial lapsed, its archive expiring in five days.
    function paused(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
        return snapshot({
            trialEndsAt: ago(86 * DAY),
            subscriptionEntitled: false,
            trialLapsed: true,
            boxesArchivedAt: archivedAt,
            pausedArchive: { archivedAt, expiresAt: ahead(5 * DAY) },
            ...overrides,
        })
    }

    it('warns the founder in the week before the archive expires', () => {
        expect(pickLifecycleEmail(paused(), NOW)?.sequenceKey).toBe('workspace_archive_expiring')
        expect(pickLifecycleEmail(paused({ isFounder: false }), NOW)).toBeNull()
    })

    it('opens a week out and closes at the expiry', () => {
        const expiringIn = (ms: number) => paused({ pausedArchive: { archivedAt, expiresAt: ahead(ms) } })

        expect(pickLifecycleEmail(expiringIn(7 * DAY + HOUR), NOW)).toBeNull()
        expect(pickLifecycleEmail(expiringIn(7 * DAY), NOW)?.sequenceKey).toBe('workspace_archive_expiring')
        expect(pickLifecycleEmail(expiringIn(HOUR), NOW)?.sequenceKey).toBe('workspace_archive_expiring')
        expect(pickLifecycleEmail(expiringIn(-HOUR), NOW)).toBeNull()
    })

    it('says nothing to a workspace that is not paused', () => {
        expect(pickLifecycleEmail(paused({ boxesArchivedAt: null }), NOW)).toBeNull()
        expect(pickLifecycleEmail(paused({ pausedArchive: null }), NOW)).toBeNull()
    })

    // Entitled with the machine still archived is a restore under way.
    it('says nothing once access is back', () => {
        expect(pickLifecycleEmail(paused({ subscriptionEntitled: true, trialLapsed: false }), NOW)).toBeNull()
    })

    // A never-paid trial whose first charge was declined reads `past_due`, which is entitled.
    it('treats a lapsed trial still on past_due as paused', () => {
        expect(pickLifecycleEmail(paused({ subscriptionEntitled: true, trialLapsed: true }), NOW)?.sequenceKey).toBe('workspace_archive_expiring')
    })

    it('is sent once per archive, not once per workspace', () => {
        expect(pickLifecycleEmail(paused({ sent: [sent('workspace_archive_expiring', { sentAt: ago(DAY) })] }), NOW)).toBeNull()
        expect(pickLifecycleEmail(paused({ sent: [sent('workspace_archive_expiring', { sentAt: archivedAt })] }), NOW)).toBeNull()

        // Sent about an earlier pause, before this archive was taken.
        const earlier = sent('workspace_archive_expiring', { sentAt: new Date(archivedAt.getTime() - DAY) })
        expect(pickLifecycleEmail(paused({ sent: [earlier] }), NOW)?.sequenceKey).toBe('workspace_archive_expiring')
    })

    it('ignores the category opt-out and the daily cap', () => {
        const muted = paused({ wantsBilling: false, wantsProduct: false, sent: [sent('agent_idle', { sentAt: ago(HOUR) })] })
        expect(pickLifecycleEmail(muted, NOW)?.sequenceKey).toBe('workspace_archive_expiring')
    })

    it('stays silent for a sandbox', () => {
        expect(pickLifecycleEmail(paused({ isSandbox: true }), NOW)).toBeNull()
    })
})

describe('the renewal reminder', () => {
    const paying = { subscriptionEntitled: true, subscriptionPaid: true, trialEndsAt: ago(90 * DAY) }

    it('goes out once its date has come, and not before', () => {
        expect(pickLifecycleEmail(snapshot({ ...paying, renewalReminderAt: ahead(HOUR) }), NOW)).toBeNull()
        expect(pickLifecycleEmail(snapshot({ ...paying, renewalReminderAt: ago(HOUR) }), NOW)?.sequenceKey).toBe('renewal_reminder_7d')
        expect(pickLifecycleEmail(snapshot({ ...paying, renewalReminderAt: ago(5 * DAY) }), NOW)).toBeNull()
    })

    // Asked for, so sent to whoever asked: the founder rule of the other billing emails does not apply.
    it('reaches the person who asked even when they are not the founder', () => {
        expect(pickLifecycleEmail(snapshot({ ...paying, isFounder: false, renewalReminderAt: ago(HOUR) }), NOW)?.sequenceKey).toBe('renewal_reminder_7d')
    })

    it('says nothing about a renewal that will not happen', () => {
        expect(pickLifecycleEmail(snapshot({ ...paying, renewalReminderAt: ago(HOUR), subscriptionCancelAt: ahead(10 * DAY) }), NOW)).toBeNull()
        expect(pickLifecycleEmail(snapshot({ subscriptionPaid: false, renewalReminderAt: ago(HOUR), trialEndsAt: ahead(10 * DAY) }), NOW)).toBeNull()
    })

    it('sends once per request, and again for a later one', () => {
        const due = snapshot({ ...paying, renewalReminderAt: ago(HOUR), sent: [sent('renewal_reminder_7d', { sentAt: ago(30 * 60_000) })] })
        expect(pickLifecycleEmail(due, NOW)).toBeNull()

        const nextMonth = snapshot({ ...paying, renewalReminderAt: ago(HOUR), sent: [sent('renewal_reminder_7d', { sentAt: ago(30 * DAY) })] })
        expect(pickLifecycleEmail(nextMonth, NOW)?.sequenceKey).toBe('renewal_reminder_7d')
    })

    it('is not used up by a reminder a colleague asked for', () => {
        const colleague = snapshot({ ...paying, renewalReminderAt: ago(HOUR), sent: [sent('renewal_reminder_7d', { sentAt: ago(30 * 60_000), recipientId: 'user-2' })] })
        expect(pickLifecycleEmail(colleague, NOW)?.sequenceKey).toBe('renewal_reminder_7d')
    })
})

describe('the paused activation group', () => {
    it('stays off the ladder the sweeper walks', async () => {
        const { ACTIVATION_SEQUENCES, LIFECYCLE_LADDER } = await vi.importActual<typeof Sequences>('./sequences')

        expect(LIFECYCLE_LADDER.filter(key => ACTIVATION_SEQUENCES.has(key))).toEqual([])
    })
})
