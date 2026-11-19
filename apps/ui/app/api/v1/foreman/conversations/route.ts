import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { listForemanConversations } from '@/lib/foreman/conversation'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.listForemanConversations, { auth: 'member' }, async ({ ctx }) => listForemanConversations(ctx))
