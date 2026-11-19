'use client'

import { useChat } from '@ai-sdk/react'
import { FOREMAN_AGENT_ID, FOREMAN_INTENT_PART, sleep, type ForemanIntent } from '@moldwright/contracts'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { OrbActivity } from '@/components/foreman/Orb'
import { isForemanClientTool, runForemanClientTool, type ForemanClientGates, type ForemanClientToolName } from '@/components/foreman/foremanClientTools'
import { refreshForemanSurface } from '@/components/foreman/useForemanKickoff'
import { getRunAction } from '@/app/api/_actions/agent.actions'
import type { SessionUsageSeed } from '@/app/api/_services/chat.service'
import { readAgentModel, useAgentModel } from '@/hooks/useAgentModel'
import { useRunReconnect } from '@/hooks/useRunReconnect'
import { refreshWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import { contextStatsOf } from '@/lib/chat/context-stats'
import { historyCovers, needsReconcile } from '@/lib/chat/transcript-reconcile'
import { isWorkspaceApiEntitled } from '@moldwright/cloud/billing'
import { lastUserText } from '@/lib/chat-payload'
import { PHONE_REQUIRED_MESSAGE } from '@moldwright/cloud/phone'
import { findPendingEngineHitl, findPendingWidget, resumesAfterAnswer } from '@/lib/foreman/pending-widget'
import type { ForemanBackend } from '@/lib/foreman/phase'
import { sealPendingWidgets, withTypedAnswer } from '@/lib/foreman/seal-pending'
import { selectForemanBackend, selectForemanOpen, useForemanStore } from '@/stores/foreman.store'
import { useIsWorkspaceAdmin, useSession } from '@/supabase/session/SessionProvider'

type RestoredConversation = { sessionId: string; backend: ForemanBackend; messages: UIMessage[]; usage?: SessionUsageSeed | null; lastError?: string | null; activeRunId?: string | null }

async function fetchEngineTranscript(sessionId: string): Promise<UIMessage[]> {
    const res = await fetch(`/api/chat/foreman/engine?sessionId=${encodeURIComponent(sessionId)}`)
    if (!res.ok) return []
    return ((await res.json()) as { messages?: UIMessage[] }).messages ?? []
}

export function useForemanChat() {
    const sessionId = useForemanStore(state => state.sessionId)
    const backend = useForemanStore(selectForemanBackend)
    const surface = useForemanStore(state => state.surface)
    const setActivity = useForemanStore(state => state.setActivity)
    const open = useForemanStore(selectForemanOpen)
    const engaged = useForemanStore(state => state.engaged)
    const { workspace, refreshPhoneStep } = useSession()
    const isAdmin = useIsWorkspaceAdmin()

    const gates = useRef<ForemanClientGates>({ apiEntitled: false, isSandbox: false, isAdmin: false })
    useEffect(() => {
        gates.current = { apiEntitled: !!workspace && isWorkspaceApiEntitled(workspace), isSandbox: !!workspace?.is_sandbox, isAdmin }
    }, [workspace, isAdmin])

    const transport = useMemo(
        () =>
            new DefaultChatTransport<UIMessage>({
                api: '/api/chat/foreman',
                body: () => ({ sessionId }),
            }),
        [sessionId]
    )

    const autoResumePending = useRef(false)

    const hubChat = useChat<UIMessage>({
        id: sessionId,
        transport,
        sendAutomaticallyWhen: chat => (autoResumePending.current = resumesAfterAnswer(chat)),
        onToolCall: ({ toolCall }) => {
            if (!isForemanClientTool(toolCall.toolName)) return
            const output = runForemanClientTool(toolCall.toolName as ForemanClientToolName, toolCall.input, gates.current)
            void hubChat.addToolResult({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output })
        },
    })

    const activeRunId = useForemanStore(state => state.engineRunId)
    const holdRun = useForemanStore(state => state.setEngineRunId)
    const completedRef = useRef(false)
    const engineTransport = useMemo(
        () =>
            new DefaultChatTransport<UIMessage>({
                api: '/api/chat/foreman/engine',
                body: () => ({ sessionId, ...readAgentModel(FOREMAN_AGENT_ID) }),
                prepareSendMessagesRequest: ({ body, messages }) => ({ body: { ...body, text: lastUserText(messages) } }),
                prepareReconnectToStreamRequest: () => ({ api: `/api/chat/resume?agentId=${FOREMAN_AGENT_ID}&runId=${encodeURIComponent(useForemanStore.getState().engineRunId ?? '')}` }),
                fetch: (async (url: string | URL | Request, init?: RequestInit) => {
                    const res = await fetch(url, init)
                    if (init?.method === 'POST') holdRun(res.headers.get('X-Run-Id'))
                    return res
                }) as typeof globalThis.fetch,
            }),
        [sessionId, holdRun]
    )

    const engineChat = useChat<UIMessage>({
        id: `engine-${sessionId}`,
        transport: engineTransport,
        experimental_throttle: 80,
        onData: part => {
            if (part.type !== FOREMAN_INTENT_PART) return
            const { tool, input } = part.data as ForemanIntent
            if (isForemanClientTool(tool)) runForemanClientTool(tool, input, gates.current)
        },
        onFinish: ({ isAbort, isDisconnect, isError }) => {
            if (selectForemanBackend(useForemanStore.getState()) === 'engine' && !isDisconnect && !isError) void refreshWorkspaceConnections()
            if (isAbort || isDisconnect || isError) return
            completedRef.current = true
            holdRun(null)
        },
    })

    const onEngine = backend === 'engine'
    const chat = onEngine ? engineChat : hubChat
    const { status, messages } = chat
    const { setMessages: setHubMessages, sendMessage: sendHubMessage, addToolResult, status: hubStatus } = hubChat

    useEffect(() => {
        if (hubStatus !== 'ready') autoResumePending.current = false
    }, [hubStatus])
    const { sendMessage: sendEngineMessage, stop: stopEngineStream, setMessages: setEngineMessages, resumeStream: resumeEngineStream, clearError: clearEngineError, regenerate: regenerateEngine } = engineChat

    const [runErrorOf, setRunErrorOf] = useState<{ sessionId: string; text: string } | null>(null)
    const runError = runErrorOf?.sessionId === sessionId ? runErrorOf.text : null
    const setRunError = useCallback((text: string | null) => setRunErrorOf(text ? { sessionId, text } : null), [sessionId])
    const [usageOf, setUsageOf] = useState<{ sessionId: string; usage: SessionUsageSeed } | null>(null)
    const seededUsage = usageOf?.sessionId === sessionId ? usageOf.usage : null

    const { selection: modelSelection } = useAgentModel(FOREMAN_AGENT_ID)
    const contextStats = useMemo(() => (onEngine ? contextStatsOf(messages, seededUsage, modelSelection.model) : null), [onEngine, messages, seededUsage, modelSelection.model])

    const reconnecting = useRunReconnect({
        error: engineChat.error,
        completedRef,
        start: () => {
            const runId = useForemanStore.getState().engineRunId
            if (!runId) return null
            return {
                runId,
                getRun: () => getRunAction(FOREMAN_AGENT_ID, runId),
                fetchMessages: () => fetchEngineTranscript(sessionId),
                onSettled: ({ errorText }) => {
                    holdRun(null)
                    if (errorText) setRunError(errorText)
                },
            }
        },
        resumeStream: resumeEngineStream,
        setMessages: setEngineMessages as (messages: never[]) => void,
        clearError: clearEngineError,
    })

    const tail = messages.at(-1)?.parts.at(-1)
    const activity: OrbActivity = status === 'submitted' ? 'thinking' : status !== 'streaming' ? 'idle' : tail?.type === 'text' && tail.state === 'streaming' ? 'speaking' : 'thinking'

    useEffect(() => {
        setActivity(activity)
    }, [activity, setActivity])

    const send = useCallback(
        (message: { text: string }, options?: { queued?: boolean }): boolean => {
            const store = useForemanStore.getState()
            if (store.backend === 'hub' && store.surface === 'engine') {
                store.newChat()
                store.askForeman(message.text)
                return true
            }
            if (!onEngine && autoResumePending.current) return false
            store.pinBackend()
            setRunErrorOf(null)
            if (onEngine) {
                void sendEngineMessage(message, options?.queued ? { body: { queued: true } } : undefined)
                return true
            }
            setHubMessages(current => withTypedAnswer(current, message.text))
            void sendHubMessage()
            return true
        },
        [onEngine, sendEngineMessage, sendHubMessage, setHubMessages]
    )

    const answeredCalls = useRef(new Set<string>())
    useEffect(() => {
        answeredCalls.current = new Set()
    }, [sessionId])

    const answerWidget = useCallback(
        (tool: string, toolCallId: string, output: unknown) => {
            if (onEngine) return void send({ text: String(output) })
            if (answeredCalls.current.has(toolCallId)) return
            answeredCalls.current.add(toolCallId)
            void addToolResult({ tool, toolCallId, output })
        },
        [onEngine, send, addToolResult]
    )

    const [dismissedCallId, setDismissedCallId] = useState<string | null>(null)

    const pendingWidget = useMemo(() => {
        const pending = onEngine ? findPendingEngineHitl(messages, status) : findPendingWidget(messages, status)
        return pending?.toolCallId === dismissedCallId ? null : pending
    }, [onEngine, messages, status, dismissedCallId])

    const [stopping, setStopping] = useState(false)
    const stop = useCallback(async () => {
        setStopping(true)
        try {
            if (!onEngine) {
                autoResumePending.current = false
                return await hubChat.stop()
            }
            await stopEngineStream()
            const params = new URLSearchParams({ sessionId })
            const runId = useForemanStore.getState().engineRunId
            if (runId) params.set('runId', runId)
            holdRun(null)
            clearEngineError()
            await fetch(`/api/chat/foreman/engine?${params}`, { method: 'DELETE' }).catch(() => {})
        } finally {
            setStopping(false)
        }
    }, [onEngine, hubChat, stopEngineStream, clearEngineError, holdRun, sessionId])

    const dismissWidget = useCallback(
        (toolCallId: string) => {
            if (!onEngine) return setHubMessages(current => sealPendingWidgets(current, 'dismissed'))
            setDismissedCallId(toolCallId)
            void stop()
        },
        [onEngine, setHubMessages, stop]
    )

    const turnedAway = [hubChat.error, engineChat.error].some(err => !!err && /onboarding_over|foreman_unavailable/.test(err.message))
    useEffect(() => {
        if (turnedAway) void refreshForemanSurface()
    }, [turnedAway])

    const owesPhone = [hubChat.error, engineChat.error].some(err => !!err && err.message.includes(PHONE_REQUIRED_MESSAGE))
    useEffect(() => {
        if (owesPhone) void refreshPhoneStep()
    }, [owesPhone, refreshPhoneStep])

    const restored = useRef<RestoredConversation | null>(null)
    const asked = useRef(false)
    const [restoreDone, setRestoreDone] = useState(false)
    useEffect(() => {
        if ((!open && !engaged) || asked.current || surface === 'unknown' || surface === 'none') return
        asked.current = true
        void fetch(surface === 'engine' ? '/api/chat/foreman/engine' : '/api/chat/foreman')
            .then(res => (res.ok ? (res.json() as Promise<RestoredConversation | null>) : null))
            .then(conversation => {
                if (!conversation?.messages.length) {
                    setRestoreDone(true)
                    return
                }
                restored.current = conversation
                useForemanStore.getState().setSessionId(conversation.sessionId, conversation.backend)
            })
            .catch(() => setRestoreDone(true))
    }, [open, engaged, surface])

    const engineLive = useRef({ messages: engineChat.messages, status: engineChat.status })
    useEffect(() => {
        engineLive.current = { messages: engineChat.messages, status: engineChat.status }
    }, [engineChat.messages, engineChat.status])
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const attachToRun = useCallback(
        async (conversationId: string, runId: string) => {
            const run = await getRunAction(FOREMAN_AGENT_ID, runId).catch(() => null)
            if (!mounted.current) return
            if (run?.status === 'error' && run.error) setRunError(run.error)
            if (!run || run.status === 'running') await resumeEngineStream().catch(() => {})
            for (let i = 0; i < 5 && mounted.current; i++) {
                const data = await fetchEngineTranscript(conversationId).catch(() => [])
                const live = engineLive.current
                if (!mounted.current || live.status === 'submitted' || live.status === 'streaming') return
                if (!needsReconcile(live.messages)) return
                if (historyCovers(live.messages, data)) {
                    setEngineMessages(data)
                    return
                }
                await sleep(600)
            }
        },
        [resumeEngineStream, setEngineMessages, setRunError]
    )

    useEffect(() => {
        const conversation = restored.current
        if (!conversation || conversation.sessionId !== sessionId) return
        restored.current = null
        if (conversation.backend === 'engine') {
            setEngineMessages(conversation.messages)
            setUsageOf(conversation.usage ? { sessionId, usage: conversation.usage } : null)
            setRunError(conversation.lastError ?? null)
            if (conversation.activeRunId) {
                holdRun(conversation.activeRunId)
                void attachToRun(conversation.sessionId, conversation.activeRunId)
            }
        } else setHubMessages(conversation.messages)
        setRestoreDone(true)
    }, [sessionId, setHubMessages, setEngineMessages, holdRun, attachToRun, setRunError])

    const composerBackend: ForemanBackend = surface === 'engine' ? 'engine' : backend

    const regenerate = useCallback(
        (messageId: string) => {
            setRunErrorOf(null)
            void regenerateEngine({ messageId })
        },
        [regenerateEngine]
    )

    const error = onEngine && reconnecting ? undefined : chat.error

    return { ...chat, error, stop, stopping, sendMessage: send, regenerate, answerWidget, dismissWidget, pendingWidget, restoreDone, composerBackend, backend, contextStats, runError, reconnecting: onEngine && reconnecting, activeRunId: onEngine ? activeRunId : null }
}
