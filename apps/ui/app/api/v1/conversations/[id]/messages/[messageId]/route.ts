import { deleteConversationMessage } from '@/app/api/_services/conversation.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const DELETE = apiRoute(mobileApi.deleteConversationMessage, { auth: 'member' }, async ({ params }) => {
    await deleteConversationMessage(params.id, params.messageId)
})
