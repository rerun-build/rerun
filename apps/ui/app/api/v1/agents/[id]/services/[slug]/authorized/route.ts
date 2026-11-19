import { actorFromContext } from '@/app/api/_auth/access'
import { claimParkedSignIn, finishParkedSignIn, markServiceAuthorized } from '@/app/api/_services/oauth-claim.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { serviceKeyParam } from '@/app/api/v1/_lib/service-view'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The callback ran in a browser with no session, so it parked what the provider handed over. The app,
// as the member who started the sign-in, claims it here: the token lands on the engine and the entry
// flips to active, nothing before.
export const POST = apiRoute(mobileApi.claimServiceSignIn, { auth: 'member' }, async ({ ctx, params, body }) => {
    const key = serviceKeyParam(params)
    const actor = actorFromContext(ctx)
    const parked = await claimParkedSignIn(body.claim, { agentId: params.id, workspaceId: ctx.workspace.id, userId: ctx.userId })
    if (parked.kind !== 'mcp' && parked.key !== key) throw new ApiError(409, refusal('signInForAnotherApp'))
    await finishParkedSignIn(params.id, actor, parked)
    if (parked.kind === 'mcp') await markServiceAuthorized(params.id, key, actor)
})
