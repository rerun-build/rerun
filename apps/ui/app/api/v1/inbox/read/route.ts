import { markInboxRead } from '@/app/api/_services/inbox.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { markHandledSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: markHandledSchema }, async ({ ctx, body }) => {
    await markInboxRead(ctx, 'all' in body ? 'all' : body.sessionIds)
})
