import { actorFromContext, assertSpaceAccess } from '@/app/api/_auth/access'
import { resolveSpaceTarget } from '@/app/api/_services/space.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { listConnections } from '@/lib/engine/client'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx, params }) => {
    const [{ conn }] = await Promise.all([resolveSpaceTarget(params.id, ctx.workspace.id), assertSpaceAccess(params.id, 'use', actorFromContext(ctx))])
    try {
        return await listConnections(conn)
    } catch (err) {
        console.error('[api/v1] box connections unreachable', err)
        throw new ApiError(502, refusal('workspaceMachineNotAnswering'))
    }
})
