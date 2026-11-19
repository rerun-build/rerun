import { readSessionMessages } from '@/app/api/_services/conversation.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { toApiMessages } from '@/lib/chat/engine-history'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ params }) => {
    const messages = await readSessionMessages(params.id).catch(err => {
        if (err instanceof AuthorizationError) throw err
        console.error('[api/v1] conversation messages unreachable', err)
        throw new ApiError(502, refusal('boxDidNotAnswer'))
    })
    return toApiMessages(messages)
})
