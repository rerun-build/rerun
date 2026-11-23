import { actorFromContext } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { getAgentKeys, updateAgentKeys } from '@/lib/engine/client'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// Variable names only, in both directions: a value is written once onto the Box and never read back.
export const GET = apiRoute(mobileApi.getAgentKeys, { auth: 'member' }, async ({ ctx, params }) => {
    const { conn, engineAgentId } = await resolveAgentTarget(params.id, 'manage', actorFromContext(ctx))
    return getAgentKeys(conn, engineAgentId)
})

export const PUT = apiRoute(mobileApi.updateAgentKeys, { auth: 'member' }, async ({ ctx, params, body }) => {
    const { conn, engineAgentId } = await resolveAgentTarget(params.id, 'manage', actorFromContext(ctx))
    return { keys: await updateAgentKeys(conn, engineAgentId, body) }
})
