import { addAiConnection, readAiConnectionsView } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { aiConnectionsForClient } from '@/app/api/v1/_lib/legacy-client'
import { CONNECTION_TOKEN_KEY, createAiConnectionInputSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ req, ctx }) => aiConnectionsForClient(req, await readAiConnectionsView(ctx)))

export const POST = apiRoute({ auth: 'admin', body: createAiConnectionInputSchema }, async ({ ctx, body }) =>
    answeringConnectionErrors(async () => ({
        connectionId: await addAiConnection(ctx.workspace.id, body.provider, body.apiKey ? { [CONNECTION_TOKEN_KEY[body.provider]]: body.apiKey } : {}, { name: body.name, baseUrl: body.baseUrl, models: body.models }),
    }))
)
