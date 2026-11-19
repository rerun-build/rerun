import { replyToConversation } from '@/app/api/_services/reply.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(mobileApi.replyToConversation, { auth: 'member' }, async ({ ctx, params, body }) => replyToConversation(ctx, params.id, body))
