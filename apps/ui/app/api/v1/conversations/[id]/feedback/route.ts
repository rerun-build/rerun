import { fetchSessionFeedbackAction, rateMessageAction } from '@/app/api/_actions/message-feedback.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { messageFeedbackRateRequestSchema, messageFeedbackScopeSchema, type MessageFeedbackEntry } from '@rerun/contracts'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const scopeQuery = z.object({ scope: messageFeedbackScopeSchema.default('agent') })

// The votes the conversation's answers already carry.
export const GET = apiRoute({ auth: 'member', query: scopeQuery }, async ({ params, query }): Promise<{ feedback: MessageFeedbackEntry[] }> => ({ feedback: await fetchSessionFeedbackAction(params.id, query.scope) }))

// The vote lands on the tap, before any details are asked for, as on the web.
export const POST = apiRoute({ auth: 'member', body: messageFeedbackRateRequestSchema }, async ({ params, body }): Promise<{ id: string }> => {
    const rated = await rateMessageAction({ sessionId: params.id, ...body })
    if (!rated.ok) throw new ApiError(rated.code === 'conversationNotFound' || rated.error === 'Conversation not found' ? 404 : 400, rated)
    return { id: rated.id }
})
