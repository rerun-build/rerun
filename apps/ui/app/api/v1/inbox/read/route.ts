import { markInboxRead } from '@/app/api/_services/inbox.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(mobileApi.markInboxRead, { auth: 'member' }, async ({ ctx, body }) => {
    await markInboxRead(ctx, 'all' in body ? 'all' : body.sessionIds)
})
