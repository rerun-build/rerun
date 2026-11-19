import { deleteAiConnection, updateAiConnection } from '@/app/api/_services/ai-connection.service'
import { connectionTarget } from '@/app/api/v1/ai-connections/_lib/target'
import { answeringConnectionErrors } from '@/app/api/v1/_lib/ai-connection-errors'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { mobileApi, RERUN_CONNECTION_ID } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute(mobileApi.updateAiConnection, { auth: 'admin' }, async ({ ctx, params, body }) =>
    answeringConnectionErrors(async () => {
        const target = await connectionTarget(ctx.workspace.id, params.id)
        await updateAiConnection(ctx.workspace.id, target.id, body)
    })
)

// Rerun comes with the plan: the web offers no delete for it either.
export const DELETE = apiRoute(mobileApi.deleteAiConnection, { auth: 'admin' }, async ({ ctx, params }) => {
    if (params.id === RERUN_CONNECTION_ID) throw new ApiError(400, refusal('rerunConnectionNotRemovable'))
    return answeringConnectionErrors(async () => {
        const target = await connectionTarget(ctx.workspace.id, params.id)
        return { released: await deleteAiConnection(ctx.workspace.id, target.id) }
    })
})
