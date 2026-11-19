import { setAgentModel } from '@/app/api/_services/agent-model.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { setAgentModelSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const PUT = apiRoute({ auth: 'member', body: setAgentModelSchema }, async ({ ctx, params, body }) => {
    await setAgentModel(ctx, params.id, body)
})
