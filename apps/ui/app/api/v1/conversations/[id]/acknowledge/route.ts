import { assertSessionInWorkspace } from '@/app/api/_auth/access'
import { clearSessionAlert } from '@/app/api/_services/chat.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(mobileApi.acknowledgeConversation, { auth: 'member' }, async ({ params }) => {
    await assertSessionInWorkspace(params.id)
    await clearSessionAlert(params.id)
})
