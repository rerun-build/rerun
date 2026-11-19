import { readAgentView } from '@/app/api/_services/board-agents.service'
import { deleteCoworker, renameCoworker } from '@/app/api/_services/coworker-details.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { agentViewForClient } from '@/app/api/v1/_lib/legacy-client'
import { renameCoworkerSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ req, ctx, params }) => agentViewForClient(req, await readAgentView(ctx, params.id)))

export const PATCH = apiRoute({ auth: 'member', body: renameCoworkerSchema }, async ({ ctx, params, body }) => {
    await renameCoworker(ctx, params.id, body)
})

export const DELETE = apiRoute({ auth: 'member' }, async ({ ctx, params }) => {
    await deleteCoworker(ctx, params.id)
})
