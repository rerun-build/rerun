import { deleteAiConnection, updateAiConnection } from '@/app/api/_services/ai-connection.service'
import { connectionTarget } from '@/app/api/v1/ai-connections/_lib/target'
import { answeringConnectionErrors } from '@/app/api/v1/_lib/ai-connection-errors'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { RERUN_CONNECTION_ID, updateConnectionSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute({ auth: 'admin', body: updateConnectionSchema }, async ({ ctx, params, body }) =>
    answeringConnectionErrors(async () => {
        const target = await connectionTarget(ctx.workspace.id, params.id)
        await updateAiConnection(ctx.workspace.id, target.id, body)
    })
)

export const DELETE = apiRoute({ auth: 'admin' }, async ({ ctx, params }) => {
    if (params.id === RERUN_CONNECTION_ID) throw new ApiError(400, 'Rerun comes with your plan and cannot be removed.')
    return answeringConnectionErrors(async () => {
        const target = await connectionTarget(ctx.workspace.id, params.id)
        return { released: await deleteAiConnection(ctx.workspace.id, target.id) }
    })
})
