import { fetchSessionFeedbackAction, rateMessageAction } from '@/app/api/_actions/message-feedback.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { messageFeedbackRateRequestSchema, messageFeedbackScopeSchema, type MessageFeedbackEntry } from '@rerun/contracts'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const scopeQuery = z.object({ scope: messageFeedbackScopeSchema.default('agent') })

export const GET = apiRoute({ auth: 'member', query: scopeQuery }, async ({ params, query }): Promise<{ feedback: MessageFeedbackEntry[] }> => ({ feedback: await fetchSessionFeedbackAction(params.id, query.scope) }))

export const POST = apiRoute({ auth: 'member', body: messageFeedbackRateRequestSchema }, async ({ params, body }): Promise<{ id: string }> => {
    const rated = await rateMessageAction({ sessionId: params.id, ...body })
    if (!rated.ok) throw new ApiError(rated.error === 'Conversation not found' ? 404 : 400, rated.error)
    return { id: rated.id }
})
