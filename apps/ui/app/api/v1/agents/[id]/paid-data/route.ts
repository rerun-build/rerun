import { actorFromContext } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { patchAgent as enginePatchAgent } from '@/lib/engine/client'
import { paidDataAlwaysAllowSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// What a coworker may spend is part of what it is: like its tools on the web, setting it takes `manage`.
export const PUT = apiRoute({ auth: 'member', body: paidDataAlwaysAllowSchema }, async ({ ctx, params, body }) => {
    const { conn, engineAgentId } = await resolveAgentTarget(params.id, actorFromContext(ctx), 'manage')
    await enginePatchAgent(conn, engineAgentId, { paidDataAlwaysAllow: body.alwaysAllow })
})
