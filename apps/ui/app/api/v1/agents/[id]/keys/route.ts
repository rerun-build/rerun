import { actorFromContext } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { getAgentKeys, updateAgentKeys } from '@/lib/engine/client'
import { updateAgentKeysSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx, params }) => {
    const { conn, engineAgentId } = await resolveAgentTarget(params.id, actorFromContext(ctx), 'manage')
    return getAgentKeys(conn, engineAgentId)
})

export const PUT = apiRoute({ auth: 'member', body: updateAgentKeysSchema }, async ({ ctx, params, body }) => {
    const { conn, engineAgentId } = await resolveAgentTarget(params.id, actorFromContext(ctx), 'manage')
    return { keys: await updateAgentKeys(conn, engineAgentId, body) }
})
