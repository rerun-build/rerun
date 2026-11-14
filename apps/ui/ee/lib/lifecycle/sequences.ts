import type { EmailCategory } from '@/lib/notifications/prefs'

export const LIFECYCLE_SEQUENCE_KEYS = [
    'subscription_ending_24h',
    'subscription_ending_3d',
    'subscription_ending_7d',
    'renewal_reminder_7d',
    'trial_ended',
    'trial_ending_2h',
    'trial_ending_3d',
    'workspace_archive_expiring',
    'team_invite',
    'automate_agent',
    'agent_idle',
    'onboarding_resume',
    'agent_recommendations',
    'creator_pitch',
    'trial_started',
    'payment_failed',
    'sandbox_idle_warning',
] as const

export type LifecycleSequenceKey = (typeof LIFECYCLE_SEQUENCE_KEYS)[number]

export type LifecycleScope = 'user' | 'workspace' | 'agent'

export type LifecycleSequence = {
    category: EmailCategory
    scope: LifecycleScope
    urgent: boolean
    mandatory: boolean
    delayMs: number
    maxAgeMs: number
    rank: number
}

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

export const TRIAL_FINAL_NOTICE_LEAD_MS = 2 * HOUR

export const ARCHIVE_EXPIRING_LEAD_MS = 7 * DAY

export const LIFECYCLE_SEQUENCES: Record<LifecycleSequenceKey, LifecycleSequence> = {
    subscription_ending_24h: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: DAY, rank: 0 },
    subscription_ending_3d: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: 2 * DAY, rank: 1 },
    subscription_ending_7d: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: 4 * DAY, rank: 2 },
    renewal_reminder_7d: { category: 'billing', scope: 'user', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: 4 * DAY, rank: 2 },
    trial_ended: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: 2 * DAY, rank: 3 },
    trial_ending_2h: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: TRIAL_FINAL_NOTICE_LEAD_MS, rank: 4 },
    trial_ending_3d: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: DAY - TRIAL_FINAL_NOTICE_LEAD_MS, rank: 5 },
    workspace_archive_expiring: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: ARCHIVE_EXPIRING_LEAD_MS, rank: 6 },
    team_invite: { category: 'product', scope: 'workspace', urgent: false, mandatory: false, delayMs: 0, maxAgeMs: 7 * DAY, rank: 7 },
    automate_agent: { category: 'product', scope: 'agent', urgent: false, mandatory: false, delayMs: 0, maxAgeMs: 14 * DAY, rank: 8 },
    agent_idle: { category: 'product', scope: 'agent', urgent: false, mandatory: false, delayMs: DAY, maxAgeMs: 2 * DAY, rank: 9 },
    onboarding_resume: { category: 'product', scope: 'user', urgent: false, mandatory: false, delayMs: DAY, maxAgeMs: 2 * DAY, rank: 10 },
    agent_recommendations: { category: 'product', scope: 'user', urgent: false, mandatory: false, delayMs: DAY, maxAgeMs: 2 * DAY, rank: 11 },
    creator_pitch: { category: 'product', scope: 'user', urgent: false, mandatory: false, delayMs: 3 * DAY, maxAgeMs: 30 * DAY, rank: 12 },
    trial_started: { category: 'billing', scope: 'workspace', urgent: true, mandatory: false, delayMs: 0, maxAgeMs: DAY, rank: 99 },
    payment_failed: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: DAY, rank: 99 },
    sandbox_idle_warning: { category: 'billing', scope: 'workspace', urgent: true, mandatory: true, delayMs: 0, maxAgeMs: DAY, rank: 99 },
}

export const SUBSCRIPTION_ENDING_LEADS: Record<'subscription_ending_7d' | 'subscription_ending_3d' | 'subscription_ending_24h', number> = {
    subscription_ending_7d: 7 * DAY,
    subscription_ending_3d: 3 * DAY,
    subscription_ending_24h: DAY,
}

export const RENEWAL_REMINDER_LEAD_MS = 7 * DAY

export const TRIAL_ENDING_LEAD_MS = DAY

export const PAUSED_LIFECYCLE_SEQUENCES: ReadonlySet<LifecycleSequenceKey> = new Set(['team_invite', 'automate_agent', 'creator_pitch', 'agent_idle', 'onboarding_resume', 'agent_recommendations'])

export const ACTIVATION_SEQUENCES: ReadonlySet<LifecycleSequenceKey> = new Set(['agent_idle', 'onboarding_resume', 'agent_recommendations'])

const INLINE_LIFECYCLE_SEQUENCES: ReadonlySet<LifecycleSequenceKey> = new Set(['trial_started', 'payment_failed', 'sandbox_idle_warning'])

export const LIFECYCLE_LADDER: LifecycleSequenceKey[] = LIFECYCLE_SEQUENCE_KEYS.filter(key => !INLINE_LIFECYCLE_SEQUENCES.has(key) && !PAUSED_LIFECYCLE_SEQUENCES.has(key)).sort((a, b) => LIFECYCLE_SEQUENCES[a].rank - LIFECYCLE_SEQUENCES[b].rank)

export const LIFECYCLE_DAILY_CAP_MS = DAY

export function lifecycleFloor(): Date | null {
    const raw = process.env.LIFECYCLE_EMAILS_START_AT
    if (!raw) return null
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}
