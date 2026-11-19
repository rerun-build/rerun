import { listAgentConversations } from '@/app/api/_services/conversation.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.listAgentConversations, { auth: 'member' }, async ({ params, ctx }) => listAgentConversations(ctx, params.id))
