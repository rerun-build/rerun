import { cancelSessionRuns, finalizeSession } from '@/app/api/_services/conversation.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(mobileApi.stopConversation, { auth: 'member' }, async ({ params }) => {
    await cancelSessionRuns(params.id)
    await finalizeSession(params.id, 'idle')
})
