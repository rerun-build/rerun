import { Hono } from 'hono'
import { USAGE_RUNS_LIMIT, usageRunsQuerySchema } from '@rerun/contracts'
import { listAgentIdsOnDisk } from '../../agents/loader.js'
import { listUsageRuns } from '../../db/repos/usage-runs.js'

export const workspaceUsageRoutes = new Hono()

workspaceUsageRoutes.get('/runs', async c => {
    const parsed = usageRunsQuerySchema.safeParse({ from: c.req.query('from'), to: c.req.query('to'), since: c.req.query('since') || undefined })
    if (!parsed.success || parsed.data.from > parsed.data.to) return c.json({ error: 'invalid usage query' }, 400)
    // `agents`: the engine ids a member reaches, read before the cap so other Boxes cannot fill it.
    const picked = c.req.query('agents')
    const reached = picked === undefined ? null : new Set(picked.split(','))
    const agentIds = (await listAgentIdsOnDisk()).filter(id => !reached || reached.has(id))
    return c.json(await listUsageRuns(agentIds, { ...parsed.data, limit: USAGE_RUNS_LIMIT }))
})
