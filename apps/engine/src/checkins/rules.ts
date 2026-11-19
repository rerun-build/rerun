import type { CheckinDigest } from '@rerun/contracts'

export type PulseDecision = 'checkin' | 'skip' | 'ask'

const HOUR_MS = 60 * 60_000
// A workspace this young gets a check-in every day: it is when the Chief of Staff shows what it can do.
export const GUARANTEED_DAYS = 14
// Past this without a check-in, one happens whatever the digest says.
export const WEEKLY_DAYS = 7
// Nobody has written for this long: the workspace is left alone.
export const DORMANT_DAYS = 30
// Two pulses never land closer than this, whatever woke the Chief of Staff in between.
const MIN_GAP_HOURS = 20

// What the box decides alone, before anyone is asked: a check-in it owes (a young workspace, a week
// without one, something broken or waiting on a person), none when there is nobody to talk to or one
// just happened, and `ask` when there is something minor the hub's triage weighs.
export function decide({ digest, lastCheckinAt, now }: { digest: CheckinDigest; lastCheckinAt: number | null; now: number }): PulseDecision {
    if (digest.daysSinceLastHumanMessage === null || digest.daysSinceLastHumanMessage >= DORMANT_DAYS) return 'skip'
    if (lastCheckinAt !== null && now - lastCheckinAt < MIN_GAP_HOURS * HOUR_MS) return 'skip'
    if (digest.workspaceAgeDays < GUARANTEED_DAYS) return 'checkin'
    if (digest.failedRuns24h >= 3 || digest.pendingQuestions > 0 || digest.appsNeedingSignIn > 0) return 'checkin'
    if (digest.daysSinceLastCheckin === null || digest.daysSinceLastCheckin >= WEEKLY_DAYS) return 'checkin'
    const somethingMinor = digest.failedRuns24h > 0 || digest.inactiveCoworkers.length > 0 || digest.openSkillProposals > 0 || digest.neverUsed.length > 0
    return somethingMinor ? 'ask' : 'skip'
}
