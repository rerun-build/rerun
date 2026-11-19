import { markSessionsHandled } from '@/app/api/_services/conversation.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { markHandledSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: markHandledSchema }, async ({ ctx, body }) => {
    await markSessionsHandled(ctx, 'all' in body ? 'all' : body.sessionIds)
})
