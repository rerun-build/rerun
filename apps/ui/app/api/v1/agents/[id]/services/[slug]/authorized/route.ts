import { actorFromContext } from '@/app/api/_auth/access'
import { claimParkedSignIn, finishParkedSignIn, markServiceAuthorized } from '@/app/api/_services/oauth-claim.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { serviceKeyParam } from '@/app/api/v1/_lib/service-view'
import { signInClaimSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: signInClaimSchema }, async ({ ctx, params, body }) => {
    const key = serviceKeyParam(params)
    const actor = actorFromContext(ctx)
    const parked = await claimParkedSignIn(body.claim, { agentId: params.id, workspaceId: ctx.workspace.id, userId: ctx.userId })
    if (parked.kind !== 'mcp' && parked.key !== key) throw new ApiError(409, 'This sign-in was for another app.')
    await finishParkedSignIn(params.id, actor, parked)
    if (parked.kind === 'mcp') await markServiceAuthorized(params.id, key, actor)
})
