import 'server-only'

import type { CheckinDigest, CheckinTriageResponse } from '@rerun/contracts'

// Whether a day the box's rules could not settle is worth a check-in, decided by a decision model
// that answers with calibrated probabilities rather than prose. Paid by Rerun like the titles of
// the conversations, and on OpenRouter's alpha decisions endpoint, hence the hand-written fetch.
//
// Calibrated on 19/11/2026 against jev-1.14: a calm workspace reads 0.00, one coworker idle with two
// proposals waiting 0.74, three idle coworkers and nothing scheduled 0.84. A wording that stressed
// the cost of interrupting read the same cases 0.37 and 0.20: the question has to name what is
// worth saying.
const DECISION_URL = 'https://openrouter.ai/api/alpha/decisions'
const TRIAGE_MODEL = process.env.RERUN_CHECKIN_TRIAGE_MODEL ?? 'typesafe/jev-1.14'
export const TRIAGE_THRESHOLD = 0.6
const TIMEOUT_MS = 5000

const QUESTION = {
    type: 'choice',
    instructions: 'An assistant looks after the AI coworkers of a small company. Once a day it may write to the person in charge with one suggestion. Given what it sees in the workspace, should it write today?',
    criteria: {
        write: 'There is one concrete, useful thing to tell them: something broken or waiting on them, a coworker set up and left unused, or a feature that would clearly help with what they are doing.',
        wait: 'Everything looks fine, or what there is to say was already said recently.',
    },
}

type DecisionsResponse = { answers?: { checkin?: { probabilities?: Record<string, unknown> } } }

function stateOf(digest: CheckinDigest) {
    return {
        workspace_age_days: digest.workspaceAgeDays,
        days_since_last_checkin: digest.daysSinceLastCheckin,
        days_since_last_human_message: digest.daysSinceLastHumanMessage,
        coworkers: digest.coworkers,
        failed_runs_24h: digest.failedRuns24h,
        failing_coworkers: digest.failingCoworkers,
        pending_questions: digest.pendingQuestions,
        apps_needing_sign_in: digest.appsNeedingSignIn,
        inactive_coworkers: digest.inactiveCoworkers,
        open_skill_proposals: digest.openSkillProposals,
        never_used: digest.neverUsed.map(feature => feature.replaceAll('_', ' ')),
    }
}

// Null when there is no key or no answer worth reading: the box then decides by its rules alone.
export async function triageCheckin(digest: CheckinDigest): Promise<CheckinTriageResponse | null> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) return null
    try {
        const response = await fetch(DECISION_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: TRIAGE_MODEL, state: stateOf(digest), questions: { checkin: QUESTION } }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!response.ok) return null
        const write = ((await response.json()) as DecisionsResponse).answers?.checkin?.probabilities?.write
        if (typeof write !== 'number' || !Number.isFinite(write)) return null
        const probability = Math.min(1, Math.max(0, write))
        return { checkin: probability >= TRIAGE_THRESHOLD, probability }
    } catch {
        return null
    }
}
