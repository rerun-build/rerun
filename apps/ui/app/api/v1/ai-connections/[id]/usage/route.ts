import { getAiConnectionUsage } from '@/app/api/_services/ai-connection.service'
import { connectionTarget } from '@/app/api/v1/ai-connections/_lib/target'
import { answeringConnectionErrors } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getAiConnectionUsage, { auth: 'member' }, async ({ ctx, params }) =>
    answeringConnectionErrors(async () => {
        const target = await connectionTarget(ctx.workspace.id, params.id)
        return getAiConnectionUsage(ctx.workspace.id, target.id)
    })
)
