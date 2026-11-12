import type { EmailCategory } from '@/lib/notifications/prefs'
import { ACTIVATION_SEQUENCES, ARCHIVE_EXPIRING_LEAD_MS, LIFECYCLE_DAILY_CAP_MS, LIFECYCLE_LADDER, LIFECYCLE_SEQUENCES, SUBSCRIPTION_ENDING_LEADS, TRIAL_ENDING_LEAD_MS, TRIAL_FINAL_NOTICE_LEAD_MS, type LifecycleSequenceKey } from './sequences'

// `runs` is only carried for the agents the automation nudge is about.
export type LifecycleAgent = { id: string; name: string; at: Date; runs?: number }

// The archive a paused workspace sits on: the latest one that completed.
export type LifecycleArchive = { archivedAt: Date; expiresAt: Date }

export type LifecycleSend = { sequenceKey: LifecycleSequenceKey; agentId: string | null; sentAt: Date; recipientId: string }

// Everything the ladder needs about one recipient, already resolved: no client, no promises, so a
// test builds one object literal and the rules stay readable in one screen.
export type LifecycleSnapshot = {
    userId: string
    workspaceId: number
    // Whether this account is the workspace's earliest member. What the workspace as a whole is doing,
    // its trial and its team, is told to one person only; the others hear about their agents.
    isFounder: boolean
    isSandbox: boolean
    // Billed by the mobile app's store, which sends its own trial and renewal reminders and is
    // where the subscription is managed: the Stripe countdowns have nothing true to say to it.
    storeBilled?: boolean
    signedUpAt: Date | null
    onboardingCompletedAt: Date | null
    trialEndsAt: Date | null
    subscriptionEntitled: boolean
    // The trial is over and nothing was ever paid: cancelled for want of a card, or its first charge
    // declined. See `isTrialLapsed`.
    trialLapsed: boolean
    // The lapse is a declined first charge rather than a missing card. Changes the copy, not the rule.
    trialPaymentFailed: boolean
    // Entitled and past the trial, so this account has a plan to lose rather than an essai to
    // convert. What separates the `subscription_ending_*` rungs from the trial ones.
    subscriptionPaid: boolean
    // When the subscription is scheduled to end. Null means it renews, and the countdown rungs
    // have nothing to count down to.
    subscriptionCancelAt: Date | null
    // Set while the workspace is paused: its machine destroyed once its data-dir was archived.
    boxesArchivedAt: Date | null
    pausedArchive: LifecycleArchive | null
    // When the renewal reminder this person asked for from the cancel flow is due. Null when they
    // did not ask, or a colleague did: it goes to the one who asked.
    renewalReminderAt: Date | null
    memberCount: number
    agentCount: number
    firstSuccessfulRunAt: Date | null
    // Successful runs across the workspace over the run scan window, which covers a whole trial.
    successfulRuns: number
    // Created, never ran. Oldest first.
    idleAgents: LifecycleAgent[]
    // Run by hand more than once on the same workflow, with no schedule behind them. `at` is the
    // last manual run, which is what the email is reacting to.
    habitAgents: LifecycleAgent[]
    // How many templates the deterministic shortlist would put in front of this account. The email
    // needs two; the send path recomputes it and can still back out.
    recommendationCount: number
    sent: LifecycleSend[]
    wantsProduct: boolean
    wantsBilling: boolean
}

export type LifecycleCandidate = {
    sequenceKey: LifecycleSequenceKey
    userId: string
    workspaceId: number
    agentId: string | null
    agentName: string | null
    category: EmailCategory
    urgent: boolean
}

type Rung = { agentId: string | null; agentName: string | null; at: Date }

// The renewal reminder is the one sequence that can come back: it answers a request, and the same
// person can ask again for a later renewal. A send only covers the request it answered, which is
// the one it went out after.
function alreadySent(snapshot: LifecycleSnapshot, key: LifecycleSequenceKey, agentId: string | null): boolean {
    // Once per archive: a notice about an earlier pause says nothing about the one in place now.
    if (key === 'workspace_archive_expiring') {
        const archivedAt = snapshot.pausedArchive?.archivedAt
        return !!archivedAt && snapshot.sent.some(sent => sent.sequenceKey === key && sent.sentAt >= archivedAt)
    }
    const scope = LIFECYCLE_SEQUENCES[key].scope
    if (key === 'renewal_reminder_7d') {
        const requestedFor = snapshot.renewalReminderAt
        return snapshot.sent.some(sent => sent.sequenceKey === key && sent.recipientId === snapshot.userId && !!requestedFor && sent.sentAt >= requestedFor)
    }
    return snapshot.sent.some(sent => sent.sequenceKey === key && (scope !== 'agent' || sent.agentId === agentId))
}

// Oldest first, and ties broken on the id: a Trigger.dev retry has to pick the same agent as the
// attempt it is replacing, or the recipient gets two emails about two different agents.
function pickAgent(agents: LifecycleAgent[], snapshot: LifecycleSnapshot, key: LifecycleSequenceKey): Rung | null {
    const eligible = agents.filter(agent => !alreadySent(snapshot, key, agent.id))
    if (eligible.length === 0) return null
    const chosen = eligible.reduce((best, agent) => {
        const delta = agent.at.getTime() - best.at.getTime()
        return delta < 0 || (delta === 0 && agent.id < best.id) ? agent : best
    })
    return { agentId: chosen.id, agentName: chosen.name, at: chosen.at }
}

// Only this person's own sends: `agent_idle` is scoped to the agent, and a colleague reminded about
// it does not use up this recipient's reminder.
function alreadyReminded(snapshot: LifecycleSnapshot): boolean {
    return snapshot.sent.some(sent => sent.recipientId === snapshot.userId && ACTIVATION_SEQUENCES.has(sent.sequenceKey))
}

// The reminders that only make sense for a Stripe plan: the charge a trial is about to turn into,
// the countdown of a cancellation and the renewal reminder of the web's cancel flow, each with a
// button to the web's billing. A store subscription gets the store's own. The trial's end and the
// archive's expiry still go out: they say the workspace is being paused, and the teardown counts
// its grace from the first.
const STRIPE_COUNTDOWN_SEQUENCES = new Set<LifecycleSequenceKey>(['trial_ending_3d', 'trial_ending_2h', 'subscription_ending_7d', 'subscription_ending_3d', 'subscription_ending_24h', 'renewal_reminder_7d'])

// What makes each rung true, and what timestamp it is reacting to. Returning the timestamp rather
// than testing the window here keeps the delay and the expiry in one place for all of them.
function evaluate(key: LifecycleSequenceKey, snapshot: LifecycleSnapshot, now: Date): Rung | null {
    if (ACTIVATION_SEQUENCES.has(key) && alreadyReminded(snapshot)) return null
    if (snapshot.storeBilled && STRIPE_COUNTDOWN_SEQUENCES.has(key)) return null

    switch (key) {
        case 'subscription_ending_7d':
        case 'subscription_ending_3d':
        case 'subscription_ending_24h':
            return endingRung(snapshot, SUBSCRIPTION_ENDING_LEADS[key])
        case 'renewal_reminder_7d': {
            // A plan set to cancel no longer renews: the cancellation countdown speaks instead.
            if (!snapshot.renewalReminderAt || !snapshot.subscriptionPaid || snapshot.subscriptionCancelAt) return null
            return { agentId: null, agentName: null, at: snapshot.renewalReminderAt }
        }
        case 'trial_ending_3d':
            return trialEndingRung(snapshot, now, TRIAL_ENDING_LEAD_MS)
        case 'trial_ending_2h':
            return trialEndingRung(snapshot, now, TRIAL_FINAL_NOTICE_LEAD_MS)
        case 'trial_ended': {
            // `trialLapsed` rather than "not entitled": a declined first charge leaves the workspace
            // `past_due`, which is entitled, and it would otherwise never hear it is about to be
            // paused. The teardown counts its grace from this send.
            if (!snapshot.isFounder) return null
            if (!snapshot.trialEndsAt || snapshot.trialEndsAt > now || !snapshot.trialLapsed) return null
            return { agentId: null, agentName: null, at: snapshot.trialEndsAt }
        }
        case 'workspace_archive_expiring': {
            if (!snapshot.isFounder || !snapshot.boxesArchivedAt || !snapshot.pausedArchive) return null
            // Entitled with the machine still archived is a restore under way, not a pause.
            if (snapshot.subscriptionEntitled && !snapshot.trialLapsed) return null
            return { agentId: null, agentName: null, at: new Date(snapshot.pausedArchive.expiresAt.getTime() - ARCHIVE_EXPIRING_LEAD_MS) }
        }
        case 'team_invite': {
            if (!snapshot.isFounder || !snapshot.firstSuccessfulRunAt || snapshot.memberCount !== 1) return null
            // A trial invites as freely as a paid plan; a lapsed one has no workspace to bring anyone into.
            if (!snapshot.subscriptionEntitled) return null
            return { agentId: null, agentName: null, at: snapshot.firstSuccessfulRunAt }
        }
        case 'automate_agent':
            return pickAgent(snapshot.habitAgents, snapshot, key)
        case 'agent_idle':
            return pickAgent(snapshot.idleAgents, snapshot, key)
        // Both read the onboarding of the workspace the person is in, and only its founder owes it: a
        // member invited into a running workspace has nothing to resume.
        case 'onboarding_resume': {
            if (!snapshot.isFounder || !snapshot.signedUpAt || snapshot.onboardingCompletedAt) return null
            return { agentId: null, agentName: null, at: snapshot.signedUpAt }
        }
        case 'agent_recommendations': {
            if (!snapshot.isFounder || !snapshot.onboardingCompletedAt || snapshot.agentCount > 0 || snapshot.recommendationCount < 2) return null
            return { agentId: null, agentName: null, at: snapshot.onboardingCompletedAt }
        }
        case 'creator_pitch': {
            if (!snapshot.isFounder || !snapshot.trialEndsAt || snapshot.trialEndsAt > now) return null
            if (snapshot.agentCount === 0 && !snapshot.firstSuccessfulRunAt) return null
            return { agentId: null, agentName: null, at: snapshot.trialEndsAt }
        }
        case 'trial_started':
        case 'payment_failed':
        case 'sandbox_idle_warning':
            return null
    }
}

// Still inside the trial: once the date is past it is `trial_ended` that speaks, and it has a very
// different thing to say. A cancelled trial, scheduled or already ended, will never be charged:
// warning it that its plan is about to start is false, and `trial_ended` still tells it at the
// deadline that its workspace is being paused.
function trialEndingRung(snapshot: LifecycleSnapshot, now: Date, leadMs: number): Rung | null {
    if (!snapshot.isFounder || snapshot.subscriptionPaid) return null
    if (snapshot.subscriptionCancelAt || !snapshot.subscriptionEntitled) return null
    if (!snapshot.trialEndsAt || snapshot.trialEndsAt <= now) return null
    return { agentId: null, agentName: null, at: new Date(snapshot.trialEndsAt.getTime() - leadMs) }
}

// A trial that gets cancelled is `trial_ended`'s business, not this one's: both would otherwise
// fire fifteen minutes apart about the same event. The window check in `pickLifecycleEmail` handles
// a deadline still in the future on its own -- the age comes out negative and the rung is skipped.
function endingRung(snapshot: LifecycleSnapshot, leadMs: number): Rung | null {
    if (!snapshot.isFounder || !snapshot.subscriptionPaid || !snapshot.subscriptionCancelAt) return null
    return { agentId: null, agentName: null, at: new Date(snapshot.subscriptionCancelAt.getTime() - leadMs) }
}

function wantsCategory(snapshot: LifecycleSnapshot, category: EmailCategory): boolean {
    return category === 'billing' ? snapshot.wantsBilling : snapshot.wantsProduct
}

/**
 * The one email this recipient gets right now, or none. Walking the ladder top down and stopping at
 * the first rung that holds is what enforces "a single activation email at a time": the three
 * activation rungs sit next to each other and only the highest can come out.
 *
 * A rung that fails, for any reason including a muted category, hands over to the one below rather
 * than ending the pass, so someone who turned off product emails still hears that their trial ended.
 * The end-of-access rungs are `mandatory` and skip the category check altogether: they announce
 * that a workspace is about to be paused, which no email preference can be read as declining.
 */
export function pickLifecycleEmail(snapshot: LifecycleSnapshot, now: Date): LifecycleCandidate | null {
    if (snapshot.isSandbox) return null

    for (const key of LIFECYCLE_LADDER) {
        const sequence = LIFECYCLE_SEQUENCES[key]
        if (!sequence.mandatory && !wantsCategory(snapshot, sequence.category)) continue

        const rung = evaluate(key, snapshot, now)
        if (!rung) continue
        if (alreadySent(snapshot, key, rung.agentId)) continue

        const age = now.getTime() - rung.at.getTime()
        if (age < sequence.delayMs || age > sequence.maxAgeMs) continue

        if (!sequence.urgent && isCapped(snapshot, now)) return null

        return {
            sequenceKey: key,
            userId: snapshot.userId,
            workspaceId: snapshot.workspaceId,
            agentId: rung.agentId,
            agentName: rung.agentName,
            category: sequence.category,
            urgent: sequence.urgent,
        }
    }

    return null
}

// Only what was sent to this person counts: a workspace-scoped email that went to a colleague blocks
// its own rung, but it does not use up this recipient's day.
function isCapped(snapshot: LifecycleSnapshot, now: Date): boolean {
    return snapshot.sent.some(sent => sent.recipientId === snapshot.userId && now.getTime() - sent.sentAt.getTime() < LIFECYCLE_DAILY_CAP_MS)
}
