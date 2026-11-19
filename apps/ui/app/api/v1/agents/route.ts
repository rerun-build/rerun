import { actorFromContext } from '@/app/api/_auth/access'
import { assertSpaceOwnedBy } from '@/app/api/_auth/ownership'
import { createAgentWithSetup } from '@/app/api/_services/agent-setup.service'
import { listBoardAgents } from '@/app/api/_services/board-agents.service'
import { startKickoff } from '@/app/api/_services/kickoff.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { type CreatedCoworker, mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.listAgents, { auth: 'member' }, async ({ ctx }) => listBoardAgents(ctx))

// The web's own creation, then its first message: the description, reformulated. A coworker that
// arrives switched off for want of a plan slot gets no message, it could not run it. Creating in a
// Box takes `manage` on it, which createAgent checks.
export const POST = apiRoute(mobileApi.createAgent, { auth: 'member' }, async ({ ctx, body }): Promise<CreatedCoworker> => {
    await assertSpaceOwnedBy(ctx.workspace.id, body.spaceId)
    const { agentId, active } = await createAgentWithSetup({ name: body.name, description: body.description, look: body.look, workspaceId: ctx.workspace.id, spaceId: body.spaceId, actor: actorFromContext(ctx) })
    if (!active || !body.description) return { agentId, active, sessionId: null, runId: null }
    const kickoff = await startKickoff(agentId, { description: body.description }, messageAuthorOf(ctx))
    return kickoff.ok ? { agentId, active, sessionId: kickoff.sessionId, runId: kickoff.runId } : { agentId, active, sessionId: null, runId: null }
})
