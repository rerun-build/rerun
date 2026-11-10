import { actorFromContext, assertAgentAccess, isAdminActor, spaceAccessMap, type Actor, type BoxAccess } from '@/app/api/_auth/access'
import { AuthorizationError, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { sealAgentDetail } from '@/app/api/_services/agent-content.service'
import { findIdleSessions, resolveAgentTarget } from '@/app/api/_services/chat.service'
import { fetchLiveSessions, sweepZombieSessions } from '@/lib/board/live-sessions'
import { agentFromRow, computeAgentStatus } from '@/lib/board/types'
import { getAgent as engineGetAgent } from '@/lib/engine/client'
import { isTemplateContentLocked } from '@/lib/templates/content-lock'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { AgentView, BoardAgent } from '@rerun/contracts'

const AGENT_COLUMNS = ['id', 'name', 'handle', 'description', 'template_id', 'status', 'col', 'row', 'workspace_id', 'space_id', 'disabled_at', 'disabled_reason'] as const

function boardAgentFromRow(row: Parameters<typeof agentFromRow>[0]): BoardAgent {
    const { position: _position, ...agent } = agentFromRow(row)
    return agent
}

// The caller's level on each Box of the workspace. An admin manages them all without a read.
async function boxAccessOfSpace(actor: Actor): Promise<(spaceId: string) => BoxAccess> {
    if (isAdminActor(actor)) return () => 'manage'
    const map = await spaceAccessMap(actor)
    return spaceId => map.get(spaceId) ?? 'none'
}

// The server side of the board's hydrate: every agent the caller reaches, in the Boxes it sees, with
// the status its live sessions give it and the caller's level on its Box. Reachability is not in
// here, it comes from the health poll, so a Box that does not answer never holds up the list.
export async function listBoardAgents(ctx: WorkspaceContext): Promise<BoardAgent[]> {
    const actor = actorFromContext(ctx)
    const [{ data, error }, accessOf] = await Promise.all([selectMany(ctx.supabase, 'agents', AGENT_COLUMNS, { workspace_id: ctx.workspace.id }, { column: 'created_at' }), boxAccessOfSpace(actor)])
    if (error) throw error
    const agents = (data ?? []).flatMap(row => {
        const access = accessOf(row.space_id)
        return access === 'none' ? [] : [{ ...boardAgentFromRow(row), access }]
    })
    if (agents.length === 0) return []

    const sessions = (await fetchLiveSessions(ctx.supabase, agents.map(a => a.id))) ?? []
    await sweepZombieSessions(ctx.supabase, sessions, sessionIds => findIdleSessions(sessionIds, actor))

    return agents.map(agent => ({ ...agent, status: computeAgentStatus(sessions.filter(s => s.agentId === agent.id), true) }))
}

export async function readAgentView(ctx: WorkspaceContext, agentId: string): Promise<AgentView> {
    const actor = actorFromContext(ctx)
    const [{ data: row, error }, { access }] = await Promise.all([selectMaybeSingle(ctx.supabase, 'agents', AGENT_COLUMNS, { id: agentId }), assertAgentAccess(agentId, 'use', actor)])
    if (error) throw error
    if (!row || row.workspace_id !== ctx.workspace.id || access === 'none') throw new AuthorizationError('coworkerNotFound')

    const agent: BoardAgent = { ...boardAgentFromRow(row), access }
    const locked = isTemplateContentLocked(agent, ctx.workspace)
    if (agent.disabledAt) return { agent, detail: null, locked }

    const { conn, engineAgentId, contentLocked } = await resolveAgentTarget(agentId, actor)
    return { agent, detail: sealAgentDetail(await engineGetAgent(conn, engineAgentId), contentLocked), locked: contentLocked }
}
