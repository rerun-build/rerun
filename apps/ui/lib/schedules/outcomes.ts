import type { EngineRun } from '@/lib/engine/types'

export type TaskSource = 'schedule' | 'trigger'

// `exitCode` is set on the run of a script routine, which has no conversation (`sessionId` is empty).
export type TaskOutcome = { runId: string; sessionId: string; status: 'done' | 'error'; startedAt: string; finishedAt: string; exitCode: number | null }

export const outcomeKey = (source: TaskSource, slug: string) => `${source}:${slug}`

// A routine the Chief of Staff set itself to come back to something runs as a check-in, under the
// routine's slug: it is still that routine's run.
const sourceOf = (run: EngineRun): TaskSource | null => (run.triggerSource === 'schedule' || run.triggerSource === 'checkin' ? 'schedule' : run.triggerSource === 'trigger' ? 'trigger' : null)

// How each scheduled task and trigger last ended, from the coworker's recent runs. A stopped run
// says nothing about the task, so the one before it speaks.
export function latestOutcomes(runs: EngineRun[]): Record<string, TaskOutcome> {
    const outcomes: Record<string, TaskOutcome> = {}
    const ended = runs.filter(run => (run.status === 'done' || run.status === 'error') && run.triggerSlug && sourceOf(run))
    for (const run of ended) {
        const key = outcomeKey(sourceOf(run)!, run.triggerSlug!)
        const finishedAt = run.finishedAt ?? run.startedAt
        if (outcomes[key] && outcomes[key].finishedAt >= finishedAt) continue
        outcomes[key] = { runId: run.id, sessionId: run.sessionId, status: run.status as TaskOutcome['status'], startedAt: run.startedAt, finishedAt, exitCode: run.exitCode ?? null }
    }
    return outcomes
}
