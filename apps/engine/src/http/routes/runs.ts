import { runGoalRecordSchema, type RunGoalRecord } from '@rerun/contracts'
import { Hono } from 'hono'
import { aggregateUsageByDay, cancelRun, getRun, listRunsByAgent } from '../../db/repos/runs.js'
import { listRunSteps, listToolCalls } from '../../db/repos/telemetry.js'
import { collectAssistantText } from '../../db/repos/messages.js'
import { resumeStreamResponse } from '../../runtime/stream.js'
import { abortRun } from '../../runtime/run-control.js'
import { abortSubRun } from '../../tools/builtin/sub-run-watch.js'
import { emitRunTerminal, triggerFromRun } from '../../runtime/run-events.js'

function goalRecord(goalJson: string | null, state: string | null, verdictsJson: string | null): RunGoalRecord | null {
    if (!goalJson) return null
    const parsed = runGoalRecordSchema.safeParse({ ...JSON.parse(goalJson), state: state ?? 'running', verdicts: JSON.parse(verdictsJson ?? '[]') })
    return parsed.success ? parsed.data : null
}

const JOB_REF_RE = /^[A-Za-z0-9._-]+#[0-9]+$/

const USAGE_RANGE_MS: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
}

export const usageRoutes = new Hono()

usageRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    const range = c.req.query('range') ?? '7d'
    const ms = USAGE_RANGE_MS[range]
    const sinceIso = range === 'all' ? null : ms ? new Date(Date.now() - ms).toISOString() : new Date(Date.now() - USAGE_RANGE_MS['7d']).toISOString()
    return c.json({ buckets: await aggregateUsageByDay(agentId, sinceIso) })
})

export const runRoutes = new Hono()

runRoutes.post('/:rid/cancel', async c => {
    const agentId = c.req.param('id')!
    const rid = c.req.param('rid')!
    const run = await getRun(agentId, rid)
    if (!run || run.agentId !== agentId) return c.json({ error: 'run not found' }, 404)
    const aborted = abortRun(rid)
    if (run.status === 'running') {
        await cancelRun(agentId, rid)
        if (!aborted) {
            await emitRunTerminal({
                agentId,
                sessionId: run.sessionId,
                runId: rid,
                trigger: triggerFromRun(run),
                kind: 'done',
                cancelled: true,
                provider: run.provider ?? undefined,
                model: run.model ?? undefined,
            })
        }
    }
    return c.json({ ok: true, aborted })
})

runRoutes.post('/:rid/tasks/:taskId/cancel', async c => {
    const agentId = c.req.param('id')!
    const rid = c.req.param('rid')!
    const run = await getRun(agentId, rid)
    if (!run || run.agentId !== agentId) return c.json({ error: 'run not found' }, 404)
    return c.json({ ok: true, aborted: abortSubRun(c.req.param('taskId')!) })
})

runRoutes.get('/:rid/stream', async c => {
    const agentId = c.req.param('id')!
    const rid = c.req.param('rid')!
    const run = await getRun(agentId, rid)
    if (!run || run.agentId !== agentId) return c.body(null, 204)
    return resumeStreamResponse(rid)
})

runRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    const limitParam = Number(c.req.query('limit'))
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50
    const sessionId = c.req.query('session') || undefined
    const status = c.req.query('status') || undefined
    const job = c.req.query('job') || undefined
    if (job !== undefined && !JOB_REF_RE.test(job)) return c.json({ error: 'job must be repo#<number>' }, 400)
    const branch = c.req.query('branch') || undefined
    if (branch !== undefined && branch.length > 200) return c.json({ error: 'branch must be at most 200 characters' }, 400)
    const rows = await listRunsByAgent(agentId, { limit, sessionId, status, job, branch })
    return c.json({ runs: rows.map(({ goalJson, goalState, goalTurns: _turns, goalVerdictsJson, ...rest }) => ({ ...rest, goal: goalRecord(goalJson, goalState, goalVerdictsJson) })) })
})

runRoutes.get('/:rid/steps', async c => {
    const agentId = c.req.param('id')!
    const rid = c.req.param('rid')!
    const run = await getRun(agentId, rid)
    if (!run || run.agentId !== agentId) return c.json({ error: 'run not found' }, 404)
    return c.json({ steps: await listRunSteps(agentId, rid) })
})

runRoutes.get('/:rid/tools', async c => {
    const agentId = c.req.param('id')!
    const rid = c.req.param('rid')!
    const run = await getRun(agentId, rid)
    if (!run || run.agentId !== agentId) return c.json({ error: 'run not found' }, 404)
    return c.json({ tools: await listToolCalls(agentId, rid) })
})

runRoutes.get('/:rid', async c => {
    const agentId = c.req.param('id')!
    const rid = c.req.param('rid')
    const run = await getRun(agentId, rid)
    if (!run || run.agentId !== agentId) return c.json({ error: 'run not found' }, 404)
    const output = await collectAssistantText(agentId, run.sessionId, run.startedAt, run.finishedAt)
    const { goalJson, goalState, goalTurns: _turns, goalVerdictsJson, ...rest } = run
    return c.json({ ...rest, output, goal: goalRecord(goalJson, goalState, goalVerdictsJson) })
})
