import { actorFromContext } from '@/app/api/_auth/access'
import { assertSpaceOwnedBy } from '@/app/api/_auth/ownership'
import { createAgentWithSetup } from '@/app/api/_services/agent-setup.service'
import { listBoardAgents } from '@/app/api/_services/board-agents.service'
import { startKickoff } from '@/app/api/_services/kickoff.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { createCoworkerSchema, type CreatedCoworker } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx }) => listBoardAgents(ctx))

export const POST = apiRoute({ auth: 'member', body: createCoworkerSchema }, async ({ ctx, body }): Promise<CreatedCoworker> => {
    await assertSpaceOwnedBy(ctx.workspace.id, body.spaceId)
    const { agentId, active } = await createAgentWithSetup({ name: body.name, description: body.description, workspaceId: ctx.workspace.id, spaceId: body.spaceId, actor: actorFromContext(ctx) })
    if (!active || !body.description) return { agentId, active, sessionId: null, runId: null }
    const kickoff = await startKickoff(agentId, { description: body.description }, messageAuthorOf(ctx))
    return kickoff.ok ? { agentId, active, sessionId: kickoff.sessionId, runId: kickoff.runId } : { agentId, active, sessionId: null, runId: null }
})
