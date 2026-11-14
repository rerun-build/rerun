import { spaceAccessMap, type Actor } from '@/app/api/_auth/access'
import { getSession, listRuns, listSessions } from '@/lib/engine/client'
import type { AgentLink, AgentStatus } from '@/lib/board/types'
import type { EngineConnection } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle, selectMany } from '@/supabase/supabase-helpers'
import { findWorkspaceEngine } from './workspace-engine.service'

export type EngineCheck =
    | { ok: true; activeAgents: number }
    | { ok: false; reason: 'unreachable' | 'not-rerun' | 'unauthorized' }

export async function verifyEngine(conn: EngineConnection): Promise<EngineCheck> {
    let activeAgents: number
    try {
        const res = await fetch(`${conn.baseUrl}/health`, {
            signal: AbortSignal.timeout(4000),
            headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
        })
        if (!res.ok) return { ok: false, reason: 'unreachable' }

        const body = (await res.json()) as { status?: unknown; activeAgents?: unknown }
        if (body.status !== 'ok' || typeof body.activeAgents !== 'number') {
            return { ok: false, reason: 'not-rerun' }
        }
        activeAgents = body.activeAgents
    } catch {
        return { ok: false, reason: 'unreachable' }
    }

    try {
        const res = await fetch(`${conn.baseUrl}/tools`, {
            signal: AbortSignal.timeout(4000),
            headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
        })
        if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' }
        if (!res.ok) return { ok: false, reason: 'unreachable' }
    } catch {
        return { ok: false, reason: 'unreachable' }
    }

    return { ok: true, activeAgents }
}

async function fetchEngineStatuses(conn: EngineConnection): Promise<Map<string, string> | null> {
    try {
        const res = await fetch(`${conn.baseUrl}/agents`, {
            signal: AbortSignal.timeout(8000),
            headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
        })
        if (!res.ok) return null
        const body = (await res.json()) as { agents?: { id: string; status?: string }[] }
        return new Map((body.agents ?? []).map(a => [a.id, a.status ?? 'idle']))
    } catch {
        return null
    }
}

function statusFromEngine(statuses: Map<string, string> | null, engineAgentId: string): AgentStatus {
    if (!statuses) return 'offline'
    return statuses.get(engineAgentId) === 'busy' ? 'working' : 'idle'
}

export type AgentHealthResult = {
    statuses: Record<string, AgentStatus | 'unconfigured'>
    links: AgentLink[]
    spaceIds: string[]
}

async function resolveCaller(conn: EngineConnection, engineAgentId: string): Promise<string | null> {
    try {
        const runs = await listRuns(conn, engineAgentId, { status: 'running', limit: 5 })
        const running = runs.find(r => r.status === 'running')
        if (!running) return null
        const session = (await getSession(conn, engineAgentId, running.sessionId)) ?? (await listSessions(conn, engineAgentId)).find(s => s.id === running.sessionId)
        return session?.originAgentId ?? null
    } catch {
        return null
    }
}

export async function checkAllAgentsHealth(actor: Actor): Promise<AgentHealthResult> {
    const { workspaceId } = actor
    const supabase = createServiceRoleClient()

    const [{ data: workspaceAgents }, { data: workspace }, accessBySpace] = await Promise.all([
        selectMany(supabase, 'agents', ['id', 'engine_agent_id', 'space_id'] as const, { workspace_id: workspaceId }),
        selectMaybeSingle(supabase, 'workspaces', ['boxes_disabled_at', 'boxes_archived_at'] as const, { id: workspaceId }),
        spaceAccessMap(actor),
    ])
    const spaceIds = [...accessBySpace].filter(([, access]) => access !== 'none').map(([id]) => id)
    const agents = (workspaceAgents ?? []).filter(agent => (accessBySpace.get(agent.space_id) ?? 'none') !== 'none')

    if (agents.length === 0) return { statuses: {}, links: [], spaceIds }

    if (workspace?.boxes_disabled_at || workspace?.boxes_archived_at) {
        return { statuses: Object.fromEntries(agents.map(agent => [agent.id, 'offline' as const])), links: [], spaceIds }
    }

    const engineToSupabase = new Map<string, string>()
    for (const a of agents) if (a.engine_agent_id) engineToSupabase.set(a.engine_agent_id, a.id)

    const engine = await findWorkspaceEngine(workspaceId)
    const engineStatuses = engine ? await fetchEngineStatuses(engine.conn) : null
    const statuses: Record<string, AgentStatus | 'unconfigured'> = {}

    for (const agent of agents) {
        statuses[agent.id] = agent.engine_agent_id ? statusFromEngine(engineStatuses, agent.engine_agent_id) : 'unconfigured'
    }

    const busy = agents.filter(a => a.engine_agent_id && statuses[a.id] === 'working')
    const edges = await Promise.all(
        busy.map(async agent => {
            const conn = engine?.conn
            if (!conn) return null
            const originEngineId = await resolveCaller(conn, agent.engine_agent_id as string)
            if (!originEngineId) return null
            const source = engineToSupabase.get(originEngineId)
            if (!source || source === agent.id) return null
            return { source, target: agent.id } satisfies AgentLink
        })
    )

    return { statuses, links: edges.filter((e): e is AgentLink => e !== null), spaceIds }
}
