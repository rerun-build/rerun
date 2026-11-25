import { actorFromContext, keepVisible, visibleSpaceIds } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { searchWorkspace } from '@/lib/engine/client'
import { selectMany } from '@/supabase/supabase-helpers'
import { WORKSPACE_SEARCH_MAX_CHARS, WORKSPACE_SEARCH_MIN_CHARS, type WorkspaceSearchHit } from '@rerun/contracts'

// The same hits as the engine's, with `agentId` the app's id of the coworker instead of the engine's.
export type WorkspaceSearchAnswer = { hits: WorkspaceSearchHit[]; truncated: boolean; unavailable: boolean }

const NOTHING: WorkspaceSearchAnswer = { hits: [], truncated: false, unavailable: false }

// Every mention of a word on the workspace's machine that the caller may read: what the workspace
// shares, plus the soul, skills, files and tables of the coworkers whose Box they reach.
export async function searchWorkspaceContent(ctx: WorkspaceContext, query: string, signal?: AbortSignal): Promise<WorkspaceSearchAnswer> {
    const q = query.trim()
    if (q.length < WORKSPACE_SEARCH_MIN_CHARS) return NOTHING
    if (q.length > WORKSPACE_SEARCH_MAX_CHARS) return { ...NOTHING, unavailable: true }
    const actor = actorFromContext(ctx)
    const [{ data, error }, spaces] = await Promise.all([selectMany(ctx.supabase, 'agents', ['id', 'engine_agent_id', 'space_id'] as const, { workspace_id: ctx.workspace.id, kind: 'coworker' }), visibleSpaceIds(actor)])
    if (error) throw error
    const appIdOf = new Map(keepVisible(data ?? [], spaces, agent => agent.space_id).flatMap(agent => (agent.engine_agent_id ? [[agent.engine_agent_id, agent.id] as const] : [])))
    try {
        const conn = await getWorkspaceConnection(ctx.workspace.id)
        const result = await searchWorkspace(conn, q, [...appIdOf.keys()], signal)
        const hits = result.hits.flatMap((hit): WorkspaceSearchHit[] => {
            if (!('agentId' in hit) || hit.agentId === null) return [hit]
            const agentId = appIdOf.get(hit.agentId)
            return agentId ? [{ ...hit, agentId }] : []
        })
        return { hits, truncated: result.truncated, unavailable: false }
    } catch {
        // No machine, a machine that predates the route, or one that did not answer in time.
        return { ...NOTHING, unavailable: true }
    }
}
