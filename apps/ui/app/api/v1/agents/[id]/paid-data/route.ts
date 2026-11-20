import { actorFromContext } from '@/app/api/_auth/access'
import { getAgentChatTarget } from '@/app/api/_services/chat.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { patchAgent as enginePatchAgent } from '@/lib/engine/client'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// What a coworker, or the Chief of Staff, may spend is part of what it is: like its tools on the web, setting it takes `manage`.
export const PUT = apiRoute(mobileApi.setPaidDataAlwaysAllow, { auth: 'member' }, async ({ ctx, params, body }) => {
    const { conn, engineAgentId } = await getAgentChatTarget(params.id, 'manage', actorFromContext(ctx))
    await enginePatchAgent(conn, engineAgentId, { paidDataAlwaysAllow: body.alwaysAllow })
})
