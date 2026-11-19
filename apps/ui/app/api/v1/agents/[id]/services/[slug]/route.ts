import { actorFromContext } from '@/app/api/_auth/access'
import { uninstallService } from '@/app/api/_services/services.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { resolveServices, serviceKeyParam } from '@/app/api/v1/_lib/service-view'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx, params }) => {
    const key = serviceKeyParam(params)
    const [service] = await resolveServices(params.id, [{ slug: key }], actorFromContext(ctx))
    if (service.notFound) throw new ApiError(404, refusal('serviceNotFoundKey', { key }))
    return service
})

export const DELETE = apiRoute({ auth: 'member' }, async ({ ctx, params }) => {
    await uninstallService(params.id, serviceKeyParam(params), actorFromContext(ctx))
})
