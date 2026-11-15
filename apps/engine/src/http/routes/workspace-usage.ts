import { Hono } from 'hono'
import { listAgentIdsOnDisk } from '../../agents/loader.js'
import { listReadings } from '../../connections/plan-readings.js'
import { groupUsage, listToolCallCounts, listUsageSteps } from '../../db/repos/usage-steps.js'
import { attributeWeeklyPoints } from '../../usage/weekly-points.js'

const DAY_MS = 24 * 60 * 60 * 1000
const RANGE_DAYS: Record<string, number | null> = { '24h': 1, '7d': 7, '30d': 30, all: null }

const pointKey = (agentId: string, jobRef: string | null, provider: string | null, model: string | null) =>
    [agentId, jobRef ?? '', provider ?? '', model ?? ''].join('|')

export const workspaceUsageRoutes = new Hono()

workspaceUsageRoutes.get('/', async c => {
    const range = c.req.query('range') ?? '7d'
    if (!Object.hasOwn(RANGE_DAYS, range)) return c.json({ error: 'invalid range' }, 400)
    const days = RANGE_DAYS[range]
    const sinceIso = days === null ? null : new Date(Date.now() - days * DAY_MS).toISOString()

    const ids = await listAgentIdsOnDisk()
    const steps = await listUsageSteps(ids, sinceIso)
    const groups = groupUsage(steps)
    const tools = await listToolCallCounts(ids, sinceIso)

    const all = await listReadings(null, 'weekly')
    const newest = all[all.length - 1]
    const readings = newest ? all.filter(r => r.connectionId === newest.connectionId) : []
    const weekly = newest
        ? { connectionId: newest.connectionId, usedPercent: newest.usedPercent, resetsAt: newest.resetsAt, capturedAt: newest.capturedAt }
        : null

    const spends = steps
        .filter(s => s.provider === 'claude')
        .map(s => ({
            at: s.at,
            key: pointKey(s.agentId, s.jobRef, s.provider, s.model),
            tokens: s.freshInput + s.output + s.cacheWrite + s.cacheRead,
        }))
    const { points, unassigned } = attributeWeeklyPoints(readings, spends)

    return c.json({
        range,
        weekly,
        groups: groups.map(g => ({
            ...g,
            points: g.provider === 'claude' ? (points[pointKey(g.agentId, g.jobRef, g.provider, g.model)] ?? 0) : null,
        })),
        tools,
        unassignedPoints: unassigned,
    })
})
