import { clearMessageFeedbackAction, updateMessageFeedbackAction } from '@/app/api/_actions/message-feedback.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// What went wrong with an answer voted down, added after the vote.
export const PATCH = apiRoute(mobileApi.updateMessageFeedback, { auth: 'member' }, async ({ params, body }) => {
    const updated = await updateMessageFeedbackAction({ id: params.id, ...body })
    if (!updated.ok) throw new ApiError(400, updated)
})

// A second tap on the same thumb takes the vote back.
export const DELETE = apiRoute(mobileApi.clearMessageFeedback, { auth: 'member' }, async ({ params }) => {
    const cleared = await clearMessageFeedbackAction(params.id)
    if (!cleared.ok) throw new ApiError(400, cleared)
})
