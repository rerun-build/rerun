import { clearMessageFeedbackAction, updateMessageFeedbackAction } from '@/app/api/_actions/message-feedback.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { messageFeedbackDetailsRequestSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute({ auth: 'member', body: messageFeedbackDetailsRequestSchema }, async ({ params, body }) => {
    const updated = await updateMessageFeedbackAction({ id: params.id, ...body })
    if (!updated.ok) throw new ApiError(400, updated.error)
})

export const DELETE = apiRoute({ auth: 'member' }, async ({ params }) => {
    const cleared = await clearMessageFeedbackAction(params.id)
    if (!cleared.ok) throw new ApiError(400, cleared.error)
})
