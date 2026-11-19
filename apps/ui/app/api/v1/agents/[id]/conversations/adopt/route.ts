import { actorFromContext } from '@/app/api/_auth/access'
import { adoptEngineSession } from '@/app/api/_services/conversation.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { adoptConversationSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: adoptConversationSchema }, async ({ ctx, params, body }) => ({ id: await adoptEngineSession(params.id, body.engineSessionId, body.title, actorFromContext(ctx)) }))
