import { createHash } from 'node:crypto'

import { readSessionTranscript } from '@/app/api/_services/conversation.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { messagesForClient } from '@/app/api/v1/_lib/legacy-client'
import { refusal } from '@/lib/i18n/action-error'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { toApiMessages } from '@/lib/chat/engine-history'
import { mobileApi, TRANSCRIPT_UPDATED_AT_HEADER } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The app sends back the ETag of the transcript it keeps: an unchanged one comes back as a 304,
// without its body. `TRANSCRIPT_UPDATED_AT_HEADER` names the version of the conversation the
// transcript was read at, which the app compares with its list of conversations to open on its
// copy without waiting. The phone keeps its own copy: nothing on the way stores this one.
export const GET = apiRoute(mobileApi.getConversationMessages, { auth: 'member' }, async ({ params, req }) => {
    const { messages, updatedAt } = await readSessionTranscript(params.id).catch(err => {
        if (err instanceof AuthorizationError) throw err
        console.error('[api/v1] conversation messages unreachable', err)
        throw new ApiError(502, refusal('boxDidNotAnswer'))
    })
    const body = JSON.stringify(messagesForClient(req, toApiMessages(messages)))
    const etag = `"${createHash('sha1').update(body).digest('base64url')}"`
    const headers: Record<string, string> = { ETag: etag, 'Cache-Control': 'no-store' }
    if (updatedAt) headers[TRANSCRIPT_UPDATED_AT_HEADER] = updatedAt
    // A proxy that compresses the body hands the ETag on as a weak one: it still names the same transcript.
    if (req.headers.get('if-none-match')?.replace(/^W\//, '') === etag) return new Response(null, { status: 304, headers })
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json' } })
})
