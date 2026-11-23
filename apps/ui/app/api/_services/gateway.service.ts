import { spaceAccessMap, type Actor } from '@/app/api/_auth/access'
import { getSession, listRuns, listSessions } from '@/lib/engine/client'
import type { AgentLink, AgentStatus } from '@/lib/board/types'
import type { EngineConnection } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle, selectMany } from '@/supabase/supabase-helpers'
import { findWorkspaceEngine } from './workspace-engine.service'
import { sitsInABox } from '@/lib/agents/in-box'

// Result of verifying that a Space points at a real, reachable rerun-engine whose
// RERUN_API_KEY we hold. Used at Space creation time to block invalid Spaces.
export type EngineCheck =
    | { ok: true; activeAgents: number }
    | { ok: false; reason: 'unreachable' | 'not-rerun' | 'unauthorized' }

export async function verifyEngine(conn: EngineConnection): Promise<EngineCheck> {
    // 1. /health is public — confirms reachability AND that this is a rerun-engine.
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

    // 2. /tools is protected — confirms the RERUN_API_KEY is accepted.
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

// Fetches the engine's agent index, which carries the live run status
// (busy/idle) for every agent on that Space regardless of what triggered the
// run (user chat, schedule, call from another agent). null = engine unreachable.
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
    // Appels agent→agent en cours (call_agent). source/target = ids Supabase.
    links: AgentLink[]
    // The Boxes the caller reaches right now: the board drops one it still draws that is not listed,
    // its access having been taken away since it loaded.
    spaceIds: string[]
}

// For a busy agent, resolve who triggered its current run: the running run pins
// the active session, whose `originAgentId` (engine id) is the caller. null when
// the run was user/schedule-initiated (no origin) or nothing is running.
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

// Only the coworkers in the Boxes the caller reaches: a caller of a hidden one would otherwise show
// up as the source of a link.
export async function checkAllAgentsHealth(actor: Actor): Promise<AgentHealthResult> {
    const { workspaceId } = actor
    const supabase = createServiceRoleClient()

    const [{ data: workspaceAgents }, { data: workspace }, accessBySpace] = await Promise.all([
        selectMany(supabase, 'agents', ['id', 'engine_agent_id', 'space_id'] as const, { workspace_id: workspaceId, kind: 'coworker' }),
        selectMaybeSingle(supabase, 'workspaces', ['boxes_disabled_at', 'boxes_archived_at'] as const, { id: workspaceId }),
        spaceAccessMap(actor),
    ])
    const spaceIds = [...accessBySpace].filter(([, access]) => access !== 'none').map(([id]) => id)
    const agents = (workspaceAgents ?? []).filter(sitsInABox).filter(agent => (accessBySpace.get(agent.space_id) ?? 'none') !== 'none')

    if (agents.length === 0) return { statuses: {}, links: [], spaceIds }

    // The teardown powered this machine off or archived it away, so no address answers. Every call
    // below would spend its full timeout to learn what these columns already say, once every ten
    // seconds, for as long as the workspace stays lapsed.
    if (workspace?.boxes_disabled_at || workspace?.boxes_archived_at) {
        return { statuses: Object.fromEntries(agents.map(agent => [agent.id, 'offline' as const])), links: [], spaceIds }
    }

    // engine agent id → Supabase id, pour retrouver l'agent appelant.
    const engineToSupabase = new Map<string, string>()
    for (const a of agents) if (a.engine_agent_id) engineToSupabase.set(a.engine_agent_id, a.id)

    // One machine per workspace, so one /agents call answers for the whole board however many
    // Boxes it is drawn in.
    const engine = await findWorkspaceEngine(workspaceId)
    const engineStatuses = engine ? await fetchEngineStatuses(engine.conn) : null
    const statuses: Record<string, AgentStatus | 'unconfigured'> = {}

    for (const agent of agents) {
        statuses[agent.id] = agent.engine_agent_id ? statusFromEngine(engineStatuses, agent.engine_agent_id) : 'unconfigured'
    }

    // Pour chaque agent occupé, retrouver l'appelant → arête source→target.
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
