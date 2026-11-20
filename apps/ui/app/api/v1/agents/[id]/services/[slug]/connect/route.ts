import { actorFromContext, assertAgentOrForemanAccess } from '@/app/api/_auth/access'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { connectUrl, serviceKeyParam, requestingDesktop } from '@/app/api/v1/_lib/service-view'
import { appReturnBase } from '@/lib/oauth/app-return'
import { mobileApi, type ConnectTarget } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// For a service already waiting on its sign-in: mints the ticket the in-app browser opens with.
export const POST = apiRoute(mobileApi.connectService, { auth: 'member' }, async ({ req, ctx, params }): Promise<ConnectTarget> => {
    await assertAgentOrForemanAccess(params.id, 'manage', actorFromContext(ctx))
    return { url: connectUrl(req, ctx, params.id, serviceKeyParam(params)), returnUrl: appReturnBase(requestingDesktop(req)) }
})
