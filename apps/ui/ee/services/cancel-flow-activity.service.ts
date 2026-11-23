import 'server-only'

import { type TemplateConnector, parseServiceRegistryKey } from '@rerun/contracts'
import { getAgentStats, listSchedules } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { readRegistry } from '@/lib/services/registry'
import { loadServiceCatalog } from '@/lib/templates/catalog'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'

// The cancel dialog opens on these figures, so a machine slow to answer is dropped, not waited for.
const ENGINE_TIMEOUT_MS = 4000

const WEEK_MS = 7 * 24 * 60 * 60_000

export type CancelFlowAgent = { key: string; name: string; runsWeek: number; connectorSlugs: string[] }

export type CancelFlowActivity = {
    // Most active first.
    agents: CancelFlowAgent[]
    connectors: TemplateConnector[]
    runsMonth: number
    schedules: number
}

type AgentActivity = { runsWeek: number; runsMonth: number; schedules: number; connectorSlugs: string[] }

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([promise.catch(() => fallback), new Promise<T>(resolve => setTimeout(() => resolve(fallback), ENGINE_TIMEOUT_MS))])
}

async function readAgentActivity(conn: EngineConnection, engineAgentId: string, weekStart: number): Promise<AgentActivity> {
    const [points, schedules, registry] = await Promise.all([
        withTimeout(getAgentStats(conn, engineAgentId, { dataset: 'runs', metric: 'count', groupBy: 'none', range: '30d' }), []),
        withTimeout(listSchedules(conn, engineAgentId), []),
        withTimeout(readRegistry(conn, engineAgentId), { services: {} }),
    ])

    // Daily buckets: the week is the last seven of them, the month all thirty.
    return {
        runsMonth: points.reduce((sum, point) => sum + point.value, 0),
        runsWeek: points.filter(point => Date.parse(point.bucket) >= weekStart).reduce((sum, point) => sum + point.value, 0),
        schedules: schedules.length,
        connectorSlugs: [...new Set(Object.keys(registry.services).map(key => parseServiceRegistryKey(key).slug))],
    }
}

export async function loadCancelFlowActivity(workspaceId: number): Promise<CancelFlowActivity | null> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return null

    const supabase = createServiceRoleClient()
    const { data: rows } = await selectMany(supabase, 'agents', ['id', 'name', 'engine_agent_id'] as const, { workspace_id: workspaceId, kind: 'coworker', engine_agent_id: { notNull: true }, disabled_at: { isNull: true } })
    const agents = (rows ?? []).flatMap(row => (row.engine_agent_id ? [{ id: row.id, name: row.name, engineAgentId: row.engine_agent_id }] : []))

    const weekStart = Date.now() - WEEK_MS
    const activity = await Promise.all(agents.map(agent => readAgentActivity(engine.conn, agent.engineAgentId, weekStart)))

    const slugs = [...new Set(activity.flatMap(entry => entry.connectorSlugs))]
    const catalog = slugs.length ? await loadServiceCatalog(supabase, slugs) : new Map()

    return {
        agents: agents
            .map((agent, index) => ({
                key: agent.id,
                name: agent.name,
                runsWeek: activity[index].runsWeek,
                // An installed service missing from the catalog has no icon to draw on the board.
                connectorSlugs: activity[index].connectorSlugs.filter(slug => catalog.has(slug)),
            }))
            .sort((a, b) => b.runsWeek - a.runsWeek),
        connectors: [...catalog.values()],
        runsMonth: activity.reduce((sum, entry) => sum + entry.runsMonth, 0),
        schedules: activity.reduce((sum, entry) => sum + entry.schedules, 0),
    }
}
