import { CRITERION_RUBRIC } from './judge'
import { CRITERIA, type AgentIdea, type Criterion, type JudgedCandidate, type Lens, type Selection } from './types'

export const MAX_IDEAS = 5
const PER_LENS_CAP = 2

const WEIGHTS: Record<Criterion, number> = { specificity: 0.3, evidence: 0.25, feasibility: 0.2, value: 0.15, novelty: 0.1 }

const FLOORS: Record<Criterion, number> = { specificity: 0.3, evidence: 0.4, feasibility: 0.5, value: 0.4, novelty: 0.5 }

export function totalScore(scores: JudgedCandidate['scores']): number {
    return CRITERIA.reduce((sum, criterion) => sum + scores[criterion].score * WEIGHTS[criterion], 0)
}

function weakestCriterion(scores: JudgedCandidate['scores']): Criterion {
    return [...CRITERIA].sort((a, b) => scores[a].score - FLOORS[a] - (scores[b].score - FLOORS[b]))[0]
}

export function selectIdeas(judged: JudgedCandidate[]): Selection {
    const ranked = judged.map(candidate => ({ candidate, total: totalScore(candidate.scores) })).sort((a, b) => b.total - a.total)

    const perLens = new Map<Lens, number>()
    const kept: AgentIdea[] = []
    const rejected: AgentIdea[] = []
    const eligible: AgentIdea[] = []

    for (const { candidate, total } of ranked) {
        const weakest = weakestCriterion(candidate.scores)
        const reject = (reason: string) => rejected.push({ ...candidate, total, verdict: { keep: false, weakest, reason } })

        if (candidate.scores[weakest].score < FLOORS[weakest]) {
            const levels = CRITERION_RUBRIC[weakest].levels
            reject(levels[Math.floor(candidate.scores[weakest].score * (levels.length - 1))])
            continue
        }
        eligible.push({ ...candidate, total, verdict: { keep: true, weakest, reason: CRITERION_RUBRIC[weakest].levels[candidate.scores[weakest].level] } })
        if (kept.length >= MAX_IDEAS) {
            reject(`Passes every floor, outranked by ${MAX_IDEAS} stronger ideas.`)
            continue
        }
        const inLens = perLens.get(candidate.lens) ?? 0
        if (inLens >= PER_LENS_CAP) {
            reject(`Passes every floor, but ${PER_LENS_CAP} stronger ideas already cover ${candidate.lens}.`)
            continue
        }
        perLens.set(candidate.lens, inLens + 1)
        kept.push({ ...candidate, total, verdict: { keep: true, weakest, reason: CRITERION_RUBRIC[weakest].levels[candidate.scores[weakest].level] } })
    }

    return { kept, rejected, eligible }
}
