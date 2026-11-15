import { AGENT_CAPABILITIES } from './capabilities'
import { CRITERIA, type CompanyDossier, type Criterion, type CriterionScore, type GroundedCandidate, type JudgedCandidate } from './types'

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
const DECISION_MODEL = process.env.RERUN_DECISION_MODEL ?? 'typesafe/jev-1.13'
const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 30_000
const PARALLEL = 5

export const CRITERION_RUBRIC: Record<Criterion, { question: string; levels: [string, string, string] }> = {
    specificity: {
        question: 'How particular to `company` is this coworker? Judge the job itself, not the names dropped into its description.',
        levels: ['Generic: any business in any industry could be handed this card, nothing in it comes from what this company sells or how it works.', 'Specific to the trade: the job comes from the kind of business this is, and its direct competitors would have it too.', 'Specific to the company: the job rests on something particular to it, a named product, competitor, customer, tool or figure, and the card would be false for a competitor.'],
    },
    evidence: {
        question: 'Do the cited `facts` show that this work exists and matters at this company?',
        levels: ['Unsupported: the cited facts do not show this work exists here, or the hook states something they do not say.', 'Inferred: the work is plausible given the facts, but none of them states it.', 'Stated: the facts directly show the work happens here or the problem exists.'],
    },
    feasibility: {
        question: 'Given `capabilities`, the connected `apps` and the `missingApps`, can the coworker run its three steps as described?',
        levels: ['Cannot run: a step depends on something coworkers cannot do today or on an app that is missing.', 'Runs with gaps: the main steps work, but one needs a person or a missing app to complete.', 'Runs as described with the apps listed.'],
    },
    value: {
        question: 'How much does taking this job off their hands matter to this company?',
        levels: ['Marginal: the work is rare or takes minutes, nobody would miss it.', 'Useful: it comes back regularly and saves a few hours a month.', 'Significant: frequent or time-consuming work, or tied directly to revenue or to a problem they named themselves.'],
    },
    novelty: {
        question: 'Compared with `existingAgents` and `earlierProposals`, is this a job nobody is doing yet?',
        levels: ['Duplicate: an existing coworker or an earlier proposal already does this job.', 'Overlapping: part of the job is already covered by an existing coworker or an earlier proposal.', 'Distinct: no existing coworker and no earlier proposal does this.'],
    },
}

type ScoreAnswer = { score?: unknown; probabilities?: unknown; confidence?: unknown }
type DecisionsResponse = { answers?: Record<string, ScoreAnswer>; usage?: { input_tokens?: number; cost?: number } }

export function readScore(answer: ScoreAnswer | undefined, levels: number): CriterionScore | null {
    const probabilities = answer?.probabilities
    if (!probabilities || typeof probabilities !== 'object') return null
    const weights = Array.from({ length: levels }, (_, level) => {
        const weight = (probabilities as Record<string, unknown>)[String(level)]
        return typeof weight === 'number' && weight > 0 ? weight : 0
    })
    const mass = weights.reduce((sum, weight) => sum + weight, 0)
    if (!mass) return null

    const expected = weights.reduce((sum, weight, level) => sum + weight * level, 0) / mass
    return {
        score: expected / (levels - 1),
        level: Math.round(expected),
        confidence: typeof answer?.confidence === 'number' ? answer.confidence : 0,
    }
}

async function decide(state: unknown, questions: Record<string, unknown>, attempt = 1): Promise<DecisionsResponse> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured')

    const response = await fetch(DECISIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: DECISION_MODEL, state, questions }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt))
        return decide(state, questions, attempt + 1)
    }
    if (!response.ok) throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 300)}`)
    return (await response.json()) as DecisionsResponse
}

const QUESTIONS = Object.fromEntries(CRITERIA.map(criterion => [criterion, { type: 'score', instructions: CRITERION_RUBRIC[criterion].question, criteria: CRITERION_RUBRIC[criterion].levels }]))

function stateFor(candidate: GroundedCandidate, earlier: GroundedCandidate[], dossier: CompanyDossier) {
    return {
        company: dossier.companyName,
        agent: { name: candidate.name, role: candidate.role, hook: candidate.hook, steps: candidate.steps, when: candidate.when, firstRun: candidate.firstRun },
        facts: candidate.evidence.map(item => `${item.topic}: ${item.text}`),
        apps: candidate.connectors.map(connector => connector.name),
        missingApps: candidate.missingApps,
        capabilities: AGENT_CAPABILITIES,
        existingAgents: dossier.existingAgents.map(agent => `${agent.name}: ${agent.description}`),
        earlierProposals: earlier.map(other => `${other.name}: ${other.role}`),
    }
}

async function judgeOne(candidate: GroundedCandidate, earlier: GroundedCandidate[], dossier: CompanyDossier): Promise<{ judged: JudgedCandidate; usd: number }> {
    const response = await decide(stateFor(candidate, earlier, dossier), QUESTIONS)
    const scores = Object.fromEntries(
        CRITERIA.map(criterion => {
            const score = readScore(response.answers?.[criterion], CRITERION_RUBRIC[criterion].levels.length)
            if (!score) throw new Error(`Jev returned no score for "${criterion}" on ${candidate.name}`)
            return [criterion, score]
        })
    ) as Record<Criterion, CriterionScore>
    return { judged: { ...candidate, scores }, usd: response.usage?.cost ?? 0 }
}

export async function judgeCandidates(candidates: GroundedCandidate[], dossier: CompanyDossier): Promise<{ judged: JudgedCandidate[]; usd: number }> {
    const results: { judged: JudgedCandidate; usd: number }[] = []
    for (let start = 0; start < candidates.length; start += PARALLEL) {
        const batch = candidates.slice(start, start + PARALLEL)
        results.push(...(await Promise.all(batch.map((candidate, offset) => judgeOne(candidate, candidates.slice(0, start + offset), dossier)))))
    }
    return { judged: results.map(result => result.judged), usd: results.reduce((sum, result) => sum + result.usd, 0) }
}
