import { actorFromContext } from '@/app/api/_auth/access'
import { claimParkedSignIn, finishParkedSignIn } from '@/app/api/_services/oauth-claim.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { signInClaimSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: signInClaimSchema }, async ({ ctx, params, body }) => {
    const parked = await claimParkedSignIn(body.claim, { agentId: params.id, workspaceId: ctx.workspace.id, userId: ctx.userId })
    if (parked.kind !== 'mcp' || parked.serverName !== params.name) throw new ApiError(409, 'This sign-in was for another server.')
    await finishParkedSignIn(params.id, actorFromContext(ctx), parked)
})
