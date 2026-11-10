import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { randomUUID } from 'expo-crypto'
import { fetch as expoFetch } from 'expo/fetch'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { clientHeader, hubHeaders } from '@/api/client'
import { fetchOnboardingConversation } from '@/api/onboarding'
import type { ChatCaller } from '@/chat/transport'
import { environment } from '@/config/environment'
import { clientPlatform } from '@/lib/client-platform'

import { widgetOf, type OnboardingWidget } from './parts'

export const KICKOFF = '[[foreman:start]]'

// A card just answered sends the conversation back on its own, as on the web. A build ends on an answered
// call too, and sent back it would land on a hub that is done with the onboarding.
export function resumesAfterAnswer({ messages }: { messages: UIMessage[] }): boolean {
    if (messages.at(-1)?.parts.some(part => part.type === 'tool-build_team')) return false
    return lastAssistantMessageIsCompleteWithToolCalls({ messages })
}

export function onboardingSendBody(sessionId: string, messages: UIMessage[]) {
    return { sessionId, messages, client: clientPlatform }
}

function onboardingTransport(callerRef: RefObject<ChatCaller | null>, sessionRef: RefObject<string>) {
    return new DefaultChatTransport<UIMessage>({
        api: `${environment.apiUrl}/api/chat/foreman`,
        headers: () => hubHeaders(clientHeader, { accessToken: callerRef.current?.accessToken, workspaceId: callerRef.current?.workspaceId }),
        fetch: expoFetch as unknown as typeof globalThis.fetch,
        prepareSendMessagesRequest: ({ messages }) => ({ body: onboardingSendBody(sessionRef.current, messages) }),
    })
}

export type OnboardingHistory = 'loading' | 'ready' | 'error'

// The hub's onboarding conversation. Unlike a coworker's chat, the hub keeps no transcript of its own to
// replay: every send carries the whole conversation, and the cards are answered as tool outputs.
export function useOnboardingChat(caller: ChatCaller | null) {
    const callerRef = useRef(caller)
    const sessionRef = useRef<string>(randomUUID())
    const [history, setHistory] = useState<OnboardingHistory>('loading')

    useEffect(() => {
        callerRef.current = caller
    }, [caller])

    // The refs go to the transport untouched: it reads them when a send leaves, never while rendering.
    // eslint-disable-next-line react-hooks/refs
    const [transport] = useState(() => onboardingTransport(callerRef, sessionRef))

    const chat = useChat({ id: 'onboarding', transport, sendAutomaticallyWhen: resumesAfterAnswer, experimental_throttle: 80 })
    const { setMessages, sendMessage, addToolOutput, status } = chat
    const busy = status === 'submitted' || status === 'streaming'

    const [version, setVersion] = useState(0)
    const load = useCallback(() => {
        setHistory('loading')
        setVersion(current => current + 1)
    }, [])

    const hasCaller = caller !== null
    useEffect(() => {
        const current = callerRef.current
        if (!hasCaller || !current) return
        let cancelled = false
        fetchOnboardingConversation(current)
            .then(conversation => {
                if (cancelled) return
                if (conversation) {
                    sessionRef.current = conversation.sessionId
                    setMessages(conversation.messages)
                }
                setHistory('ready')
            })
            .catch(() => {
                if (!cancelled) setHistory('error')
            })
        return () => {
            cancelled = true
        }
    }, [hasCaller, version, setMessages])

    const kickoff = useCallback(() => {
        return sendMessage({ text: KICKOFF })
    }, [sendMessage])

    const answer = useCallback(
        (toolCallId: string, output: unknown) => {
            const part = chat.messages.flatMap(message => message.parts).find(candidate => widgetOf(candidate)?.toolCallId === toolCallId)
            const widget = part ? widgetOf(part)?.widget : null
            if (!widget) return
            void addToolOutput({ tool: widget as OnboardingWidget, toolCallId, output } as Parameters<typeof addToolOutput>[0])
        },
        [chat.messages, addToolOutput]
    )

    const send = useCallback(
        (text: string) => {
            return sendMessage({ text })
        },
        [sendMessage]
    )

    return { messages: chat.messages, status, busy, error: chat.error, history, load, kickoff, answer, send, stop: chat.stop, regenerate: chat.regenerate }
}
