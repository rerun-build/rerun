import { actorFromContext } from '@/app/api/_auth/access'
import { installService } from '@/app/api/_services/services.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { serviceKeyParam, toInstallResultView } from '@/app/api/v1/_lib/service-view'
import { installServiceInputSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: installServiceInputSchema }, async ({ req, ctx, params, body }) => {
    const result = await installService(params.id, serviceKeyParam(params), body.values, body.authMethodId, actorFromContext(ctx))
    return toInstallResultView(result, req, ctx, params.id)
})
