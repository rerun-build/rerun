import { actorFromContext, assertAgentInWorkspace } from '@/app/api/_auth/access'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { connectUrl, serviceKeyParam, requestingDesktop } from '@/app/api/v1/_lib/service-view'
import { appReturnBase } from '@/lib/oauth/app-return'
import type { ConnectTarget } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member' }, async ({ req, ctx, params }): Promise<ConnectTarget> => {
    await assertAgentInWorkspace(params.id, 'manage', actorFromContext(ctx))
    return { url: connectUrl(req, ctx, params.id, serviceKeyParam(params)), returnUrl: appReturnBase(requestingDesktop(req)) }
})
