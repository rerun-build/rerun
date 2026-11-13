import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { listForemanConversations } from '@/lib/foreman/conversation'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx }) => listForemanConversations(ctx))
