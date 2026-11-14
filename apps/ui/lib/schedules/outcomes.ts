import type { EngineRun } from '@/lib/engine/types'

export type TaskSource = 'schedule' | 'trigger'

export type TaskOutcome = { runId: string; sessionId: string; status: 'done' | 'error'; finishedAt: string }

export const outcomeKey = (source: TaskSource, slug: string) => `${source}:${slug}`

export function latestOutcomes(runs: EngineRun[]): Record<string, TaskOutcome> {
    const outcomes: Record<string, TaskOutcome> = {}
    const ended = runs.filter(run => (run.status === 'done' || run.status === 'error') && run.triggerSlug && (run.triggerSource === 'schedule' || run.triggerSource === 'trigger'))
    for (const run of ended) {
        const key = outcomeKey(run.triggerSource as TaskSource, run.triggerSlug!)
        const finishedAt = run.finishedAt ?? run.startedAt
        if (outcomes[key] && outcomes[key].finishedAt >= finishedAt) continue
        outcomes[key] = { runId: run.id, sessionId: run.sessionId, status: run.status as TaskOutcome['status'], finishedAt }
    }
    return outcomes
}
