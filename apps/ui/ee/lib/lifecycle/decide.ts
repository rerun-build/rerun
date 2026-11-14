import type { EmailCategory } from '@/lib/notifications/prefs'
import { ACTIVATION_SEQUENCES, ARCHIVE_EXPIRING_LEAD_MS, LIFECYCLE_DAILY_CAP_MS, LIFECYCLE_LADDER, LIFECYCLE_SEQUENCES, SUBSCRIPTION_ENDING_LEADS, TRIAL_ENDING_LEAD_MS, TRIAL_FINAL_NOTICE_LEAD_MS, type LifecycleSequenceKey } from './sequences'

export type LifecycleAgent = { id: string; name: string; at: Date; runs?: number }

export type LifecycleArchive = { archivedAt: Date; expiresAt: Date }

export type LifecycleSend = { sequenceKey: LifecycleSequenceKey; agentId: string | null; sentAt: Date; recipientId: string }

export type LifecycleSnapshot = {
    userId: string
    workspaceId: number
    isFounder: boolean
    isSandbox: boolean
    signedUpAt: Date | null
    onboardingCompletedAt: Date | null
    trialEndsAt: Date | null
    subscriptionEntitled: boolean
    trialLapsed: boolean
    trialPaymentFailed: boolean
    subscriptionPaid: boolean
    subscriptionCancelAt: Date | null
    boxesArchivedAt: Date | null
    pausedArchive: LifecycleArchive | null
    renewalReminderAt: Date | null
    memberCount: number
    agentCount: number
    firstSuccessfulRunAt: Date | null
    successfulRuns: number
    idleAgents: LifecycleAgent[]
    habitAgents: LifecycleAgent[]
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

function alreadySent(snapshot: LifecycleSnapshot, key: LifecycleSequenceKey, agentId: string | null): boolean {
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

function pickAgent(agents: LifecycleAgent[], snapshot: LifecycleSnapshot, key: LifecycleSequenceKey): Rung | null {
    const eligible = agents.filter(agent => !alreadySent(snapshot, key, agent.id))
    if (eligible.length === 0) return null
    const chosen = eligible.reduce((best, agent) => {
        const delta = agent.at.getTime() - best.at.getTime()
        return delta < 0 || (delta === 0 && agent.id < best.id) ? agent : best
    })
    return { agentId: chosen.id, agentName: chosen.name, at: chosen.at }
}

function alreadyReminded(snapshot: LifecycleSnapshot): boolean {
    return snapshot.sent.some(sent => sent.recipientId === snapshot.userId && ACTIVATION_SEQUENCES.has(sent.sequenceKey))
}

function evaluate(key: LifecycleSequenceKey, snapshot: LifecycleSnapshot, now: Date): Rung | null {
    if (ACTIVATION_SEQUENCES.has(key) && alreadyReminded(snapshot)) return null

    switch (key) {
        case 'subscription_ending_7d':
        case 'subscription_ending_3d':
        case 'subscription_ending_24h':
            return endingRung(snapshot, SUBSCRIPTION_ENDING_LEADS[key])
        case 'renewal_reminder_7d': {
            if (!snapshot.renewalReminderAt || !snapshot.subscriptionPaid || snapshot.subscriptionCancelAt) return null
            return { agentId: null, agentName: null, at: snapshot.renewalReminderAt }
        }
        case 'trial_ending_3d':
            return trialEndingRung(snapshot, now, TRIAL_ENDING_LEAD_MS)
        case 'trial_ending_2h':
            return trialEndingRung(snapshot, now, TRIAL_FINAL_NOTICE_LEAD_MS)
        case 'trial_ended': {
            if (!snapshot.isFounder) return null
            if (!snapshot.trialEndsAt || snapshot.trialEndsAt > now || !snapshot.trialLapsed) return null
            return { agentId: null, agentName: null, at: snapshot.trialEndsAt }
        }
        case 'workspace_archive_expiring': {
            if (!snapshot.isFounder || !snapshot.boxesArchivedAt || !snapshot.pausedArchive) return null
            if (snapshot.subscriptionEntitled && !snapshot.trialLapsed) return null
            return { agentId: null, agentName: null, at: new Date(snapshot.pausedArchive.expiresAt.getTime() - ARCHIVE_EXPIRING_LEAD_MS) }
        }
        case 'team_invite': {
            if (!snapshot.isFounder || !snapshot.firstSuccessfulRunAt || snapshot.memberCount !== 1) return null
            if (!snapshot.subscriptionEntitled) return null
            return { agentId: null, agentName: null, at: snapshot.firstSuccessfulRunAt }
        }
        case 'automate_agent':
            return pickAgent(snapshot.habitAgents, snapshot, key)
        case 'agent_idle':
            return pickAgent(snapshot.idleAgents, snapshot, key)
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

function trialEndingRung(snapshot: LifecycleSnapshot, now: Date, leadMs: number): Rung | null {
    if (!snapshot.isFounder || snapshot.subscriptionPaid) return null
    if (snapshot.subscriptionCancelAt || !snapshot.subscriptionEntitled) return null
    if (!snapshot.trialEndsAt || snapshot.trialEndsAt <= now) return null
    return { agentId: null, agentName: null, at: new Date(snapshot.trialEndsAt.getTime() - leadMs) }
}

function endingRung(snapshot: LifecycleSnapshot, leadMs: number): Rung | null {
    if (!snapshot.isFounder || !snapshot.subscriptionPaid || !snapshot.subscriptionCancelAt) return null
    return { agentId: null, agentName: null, at: new Date(snapshot.subscriptionCancelAt.getTime() - leadMs) }
}

function wantsCategory(snapshot: LifecycleSnapshot, category: EmailCategory): boolean {
    return category === 'billing' ? snapshot.wantsBilling : snapshot.wantsProduct
}

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

function isCapped(snapshot: LifecycleSnapshot, now: Date): boolean {
    return snapshot.sent.some(sent => sent.recipientId === snapshot.userId && now.getTime() - sent.sentAt.getTime() < LIFECYCLE_DAILY_CAP_MS)
}
