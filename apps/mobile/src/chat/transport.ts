import { hubPath, mobileApi } from '@rerun/contracts'
import { DefaultChatTransport, isTextUIPart, type HttpChatTransportInitOptions, type UIMessage, type UIMessageChunk } from 'ai'
import { fetch as expoFetch } from 'expo/fetch'
import type { RefObject } from 'react'

import { clientHeader, hubHeaders } from '@/api/client'
import { environment } from '@/config/environment'

import type { ChatEndpoints } from './endpoints'

export type ChatCaller = { accessToken: string; workspaceId: number }

// Read when a send leaves, not when the transport is built: the conversation can be born from the first
// send, and the token can be refreshed between two.
export type ChatLink = {
    endpoints: ChatEndpoints
    sessionRef: RefObject<string | null>
    runRef: RefObject<string | null>
    callerRef: RefObject<ChatCaller | null>
    onSessionRef: RefObject<(sessionId: string) => void>
    // The message a stream let go on the way out left on screen, for the next replay to land on.
    resumeOntoRef: RefObject<string | null>
    // Set when the last reconnect could not reach the hub at all, for the hook to fall back on the transcript.
    reconnectFailedRef: RefObject<boolean>
}

// The engine keeps the conversation, so a send carries only the text of the new message, as on the web.
export function lastUserText(messages: UIMessage[]): string {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user') return ''
    return last.parts
        .filter(isTextUIPart)
        .map(part => part.text)
        .join('')
}

// The engine's stream opens without a message id, so a replay would add its run as a new message
// next to the one already on screen. Naming that message in the opening chunk makes it take its place.
export function withStartMessageId(stream: ReadableStream<UIMessageChunk>, messageId: string): ReadableStream<UIMessageChunk> {
    let named = false
    return stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
                if (named || chunk.type !== 'start') return controller.enqueue(chunk)
                named = true
                controller.enqueue({ ...chunk, messageId })
            },
        })
    )
}

class ChatTransport extends DefaultChatTransport<UIMessage> {
    constructor(
        private readonly link: Pick<ChatLink, 'resumeOntoRef' | 'reconnectFailedRef'>,
        options: HttpChatTransportInitOptions<UIMessage>
    ) {
        super(options)
    }

    override async reconnectToStream(options: Parameters<DefaultChatTransport<UIMessage>['reconnectToStream']>[0]) {
        const messageId = this.link.resumeOntoRef.current
        this.link.resumeOntoRef.current = null
        this.link.reconnectFailedRef.current = false
        let stream: Awaited<ReturnType<DefaultChatTransport<UIMessage>['reconnectToStream']>>
        try {
            stream = await super.reconnectToStream(options)
        } catch (error) {
            if (!options.abortSignal?.aborted) this.link.reconnectFailedRef.current = true
            throw error
        }
        return stream && messageId ? withStartMessageId(stream, messageId) : stream
    }
}

// The hub streams the engine's UI message stream as it comes; expo/fetch is the fetch that hands a
// React Native app the body as a stream. A send names the run in a response header.
export function createChatTransport(link: ChatLink) {
    const headers = () => {
        const caller = link.callerRef.current
        return hubHeaders(clientHeader, { accessToken: caller?.accessToken, workspaceId: caller?.workspaceId })
    }
    const streamingFetch = (async (input: string, init?: RequestInit) => {
        const response = await expoFetch(input, init as Parameters<typeof expoFetch>[1])
        const sessionId = init?.method === 'POST' && !link.sessionRef.current ? link.endpoints.bornSessionOf(response as unknown as Response) : null
        const runId = response.headers.get('X-Run-Id')
        if (sessionId) link.onSessionRef.current(sessionId)
        if (runId) link.runRef.current = runId
        return response
    }) as unknown as typeof globalThis.fetch

    return new ChatTransport(link, {
        api: `${environment.apiUrl}${link.endpoints.sendPath}`,
        headers,
        fetch: streamingFetch,
        // `queued` tells the hub the text waited behind a run: it retries the engine instead of dropping it.
        prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...link.endpoints.sendBody(link.sessionRef.current, lastUserText(messages)), ...(body?.queued === true && { queued: true }) } }),
        prepareReconnectToStreamRequest: () => ({ api: `${environment.apiUrl}${hubPath(mobileApi.resumeChat, {}, { agentId: link.endpoints.agentId, runId: link.runRef.current ?? '' })}`, headers: headers() }),
    })
}
