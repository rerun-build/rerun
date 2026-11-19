import { setWorkspaceDefaultModel } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const PUT = apiRoute(mobileApi.setWorkspaceDefaultModel, { auth: 'admin' }, async ({ ctx, body }) =>
    answeringConnectionErrors(() => setWorkspaceDefaultModel(ctx.workspace.id, body.connectionId && body.model ? { connectionId: body.connectionId, model: body.model } : null))
)
