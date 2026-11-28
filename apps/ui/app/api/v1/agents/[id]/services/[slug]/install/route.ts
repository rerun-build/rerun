import { actorFromContext } from '@/app/api/_auth/access'
import { installService } from '@/app/api/_services/services.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { serviceKeyParam, toInstallResultView } from '@/app/api/v1/_lib/service-view'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// A `needs_auth` result comes back with its sign-in URL already minted, so the app opens the
// in-app browser without a second round trip.
// `ownEntry`: the iPhone app's "New account" lands here without saying so, and its Vault accounts are
// lent through their own call.
export const POST = apiRoute(mobileApi.installService, { auth: 'member' }, async ({ req, ctx, params, body }) => {
    const result = await installService(params.id, serviceKeyParam(params), body.values, body.authMethodId, actorFromContext(ctx), { ownEntry: true })
    return toInstallResultView(result, req, ctx, params.id)
})
