// Background work, run in the process of the web app: there is no Trigger.dev here. A task is
// started at most once per idempotency key while the process lives, and the nightly purge runs on
// a cron of its own. A restart drops what was in flight, which every task here can afford: each
// is asked again by the screen or the flow that needs it.
import type { AnyTask, TaskOutput } from '@trigger.dev/sdk/v3'
import { Cron } from 'croner'

type Runner = (payload: never) => Promise<unknown>

const RUNNERS: Record<string, () => Promise<Runner>> = {
    'explore-company': async () => (await import('@/trigger/explore-company')).exploreCompanyRun,
    'seed-company-brain': async () => (await import('@/trigger/seed-company-brain')).seedCompanyBrainRun,
    'suggest-agent-ideas': async () => (await import('@/trigger/suggest-agent-ideas')).suggestAgentIdeasRun,
    'sync-agent-activation': async () => (await import('@/trigger/sync-agent-activation')).syncAgentActivationRun,
    'prefill-expert-application': async () => (await import('@/trigger/prefill-expert-application')).prefillExpertApplicationRun,
}

// A key is remembered for a day after its run started, like Trigger.dev keeps it.
const KEY_TTL_MS = 24 * 60 * 60_000
const runs = new Map<string, { output: Promise<unknown>; startedAt: number }>()

function log(level: 'log' | 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) {
    console[level](`[task] ${message}`, fields ?? '')
}

export const taskLogger = {
    log: (message: string, fields?: Record<string, unknown>) => log('log', message, fields),
    info: (message: string, fields?: Record<string, unknown>) => log('info', message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => log('warn', message, fields),
    error: (message: string, fields?: Record<string, unknown>) => log('error', message, fields),
}

function start(id: string, payload: unknown, idempotencyKey?: string): Promise<unknown> {
    const now = Date.now()
    for (const [key, run] of runs) if (now - run.startedAt > KEY_TTL_MS) runs.delete(key)
    const key = idempotencyKey ? `${id}:${idempotencyKey}` : null
    const existing = key ? runs.get(key) : undefined
    if (existing) return existing.output

    const loader = RUNNERS[id]
    if (!loader) return Promise.reject(new Error(`No task "${id}" in this build`))
    const output = loader().then(run => run(payload as never))
    output.catch(error => log('error', `${id} failed`, { error: error instanceof Error ? error.message : String(error) }))
    if (key) runs.set(key, { output, startedAt: now })
    return output
}

export async function triggerTask<_Task extends AnyTask = AnyTask>(id: string, payload: unknown, options?: { idempotencyKey?: string }): Promise<{ id: string }> {
    void start(id, payload, options?.idempotencyKey).catch(() => {})
    return { id: `${id}-${Date.now()}` }
}

export async function triggerTaskAndWait<Task extends AnyTask>(id: string, payload: unknown, options?: { idempotencyKey?: string }): Promise<{ ok: true; output: TaskOutput<Task> } | { ok: false; error: unknown }> {
    try {
        return { ok: true, output: (await start(id, payload, options?.idempotencyKey)) as TaskOutput<Task> }
    } catch (error) {
        return { ok: false, error }
    }
}

export function waitMinutes(minutes: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, minutes * 60_000))
}

export async function globalIdempotencyKey(key: string): Promise<string> {
    return key
}

const SCHEDULES: { pattern: string; run: () => Promise<unknown> }[] = [
    { pattern: '40 3 * * *', run: async () => (await import('@/trigger/purge-web-search-cache')).purgeWebSearchCache() },
]

const started = globalThis as { rerunSchedulesStarted?: boolean }

// Called by the dashboard layout; only the first call starts the crons.
export function startBackgroundSchedules(): void {
    if (started.rerunSchedulesStarted) return
    started.rerunSchedulesStarted = true
    for (const schedule of SCHEDULES) {
        new Cron(schedule.pattern, { protect: true }, () => {
            schedule.run().catch(error => log('error', 'scheduled task failed', { error: error instanceof Error ? error.message : String(error) }))
        })
    }
}
