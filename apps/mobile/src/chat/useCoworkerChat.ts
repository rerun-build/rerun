import { useChat } from '@ai-sdk/react'
import type { FileUIPart } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '@/auth/AuthProvider'
import { BackgroundGrace } from '@/chat/background-grace'
import type { ChatEndpoints } from '@/chat/endpoints'
import { createChatTransport, type ChatCaller } from '@/chat/transport'
import { loadTranscript, readTranscript, sameTranscript } from '@/data/local-cache'

export type HistoryState = 'loading' | 'ready' | 'error'

const GRACE_MARGIN_S = 5

export function useCoworkerChat({ endpoints, initialSessionId, onSessionCreated, onRefused }: { endpoints: ChatEndpoints; initialSessionId: string | null; onSessionCreated?: (sessionId: string) => void; onRefused?: (text: string, behindRunId: string | null) => void }) {
    const { session, me } = useAuth()
    const callerRef = useRef<ChatCaller | null>(null)
    const sessionRef = useRef(initialSessionId)
    const runRef = useRef<string | null>(null)
    const createdRef = useRef(onSessionCreated)
    const refusedRef = useRef(onRefused)
    const lastSentRef = useRef<string | null>(null)
    const resumeOntoRef = useRef<string | null>(null)
    const reconnectFailedRef = useRef(false)
    const [sessionId, setSessionId] = useState(initialSessionId)
    const [cached] = useState(() => (initialSessionId && me ? readTranscript(me.workspace.id, initialSessionId) : null))
    const [history, setHistory] = useState<HistoryState>(initialSessionId && !cached ? 'loading' : 'ready')
    const [fresh, setFresh] = useState(!initialSessionId)
    const [pageId] = useState(() => initialSessionId ?? `new-${endpoints.agentId}-${Date.now()}`)
    const [runStartedAt, setRunStartedAt] = useState(() => Date.now())

    useEffect(() => {
        callerRef.current = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
        createdRef.current = onSessionCreated
        refusedRef.current = onRefused
    }, [session, me, onSessionCreated, onRefused])

    const onSessionRef = useRef((id: string) => {
        if (sessionRef.current === id) return
        sessionRef.current = id
        setSessionId(id)
        createdRef.current?.(id)
    })
    // eslint-disable-next-line react-hooks/refs
    const [transport] = useState(() => createChatTransport({ endpoints, sessionRef, runRef, callerRef, onSessionRef, resumeOntoRef, reconnectFailedRef }))

    const chat = useChat({ id: pageId, transport, messages: cached ?? undefined, experimental_throttle: 80 })
    const { setMessages, resumeStream, status, stop: dropStream, clearError } = chat
    const shownRef = useRef(chat.messages)
    const statusRef = useRef(status)
    const streamedRef = useRef<string | null>(null)
    useEffect(() => {
        shownRef.current = chat.messages
        statusRef.current = status
        if (status === 'submitted') streamedRef.current = null
        if (status !== 'streaming') return
        const last = chat.messages.at(-1)
        streamedRef.current = last?.role === 'assistant' ? last.id : null
    }, [chat.messages, status])

    const refresh = useCallback(
        async ({ resume }: { resume: boolean }) => {
            const caller = callerRef.current
            const id = sessionRef.current
            if (!caller || !id) return
            const [messages, runId] = await Promise.all([loadTranscript(caller.workspaceId, id, () => endpoints.messages(caller, id)), resume ? endpoints.activeRun(caller, id).catch(() => null) : null])
            setHistory('ready')
            setFresh(true)
            if (statusRef.current === 'submitted' || statusRef.current === 'streaming') return
            if (!sameTranscript(messages, shownRef.current)) setMessages(messages)
            if (!runId) return
            runRef.current = runId
            setRunStartedAt(Date.now())
            await resumeStream()
        },
        [endpoints, setMessages, resumeStream]
    )

    const failToLoad = useCallback(() => setHistory(current => (current === 'loading' ? 'error' : current)), [])

    useEffect(() => {
        if (!initialSessionId || !me) return
        refresh({ resume: true }).catch(failToLoad)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSessionId, Boolean(me)])

    const [away, setAway] = useState(false)
    const awayRef = useRef(false)
    const busy = status === 'streaming' || status === 'submitted' || away
    const busyRef = useRef(busy)
    useEffect(() => {
        busyRef.current = busy
    }, [busy])

    const comeBack = useCallback(() => {
        awayRef.current = false
        setAway(false)
    }, [])

    const newerRunRef = useRef(false)

    const rejoin = useCallback(async () => {
        const caller = callerRef.current
        const id = sessionRef.current
        const followed = runRef.current
        if (!caller || !id || !followed) return refresh({ resume: true })
        resumeOntoRef.current = streamedRef.current
        const lookedUp = endpoints
            .activeRun(caller, id)
            .then(running => {
                if (running && running !== followed) newerRunRef.current = true
            })
            .catch(() => {})
        await resumeStream()
        await lookedUp
        if (!reconnectFailedRef.current) return
        clearError()
        newerRunRef.current = false
        await refresh({ resume: true })
    }, [endpoints, refresh, resumeStream, clearError])

    const letGo = useCallback(() => {
        awayRef.current = true
        setAway(true)
        dropStream().catch(() => {})
    }, [dropStream])

    const graceRef = useRef<ReturnType<typeof setTimeout> | 'asking' | null>(null)
    const endGrace = useCallback(() => {
        if (graceRef.current && graceRef.current !== 'asking') clearTimeout(graceRef.current)
        graceRef.current = null
        return BackgroundGrace?.end().catch(() => false) ?? Promise.resolve(false)
    }, [])
    useEffect(
        () => () => {
            if (graceRef.current) endGrace()
        },
        [endGrace]
    )
    useEffect(() => {
        const holdStream = async () => {
            graceRef.current = 'asking'
            const seconds = await BackgroundGrace!.begin().catch(() => 0)
            if (graceRef.current !== 'asking') {
                BackgroundGrace!.end().catch(() => {})
                return
            }
            if (seconds <= GRACE_MARGIN_S) {
                graceRef.current = null
                letGo()
                BackgroundGrace!.end().catch(() => {})
                return
            }
            graceRef.current = setTimeout(
                () => {
                    graceRef.current = null
                    if (busyRef.current) letGo()
                    BackgroundGrace!.end().catch(() => {})
                },
                (seconds - GRACE_MARGIN_S) * 1000
            )
        }
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'background' && busyRef.current && !awayRef.current && !graceRef.current && sessionRef.current) {
                if (BackgroundGrace) holdStream()
                else letGo()
                return
            }
            if (state !== 'active') return
            if (graceRef.current) {
                endGrace().then(kept => {
                    const broken = statusRef.current === 'error'
                    if (kept && !broken) return
                    if (!busyRef.current && !broken) return void refresh({ resume: true }).catch(() => {})
                    clearError()
                    letGo()
                    rejoin().catch(() => {}).finally(comeBack)
                })
                return
            }
            if (awayRef.current) {
                rejoin().catch(() => {}).finally(comeBack)
                return
            }
            if (!busyRef.current) refresh({ resume: true }).catch(() => {})
        })
        return () => subscription.remove()
    }, [refresh, rejoin, letGo, endGrace, clearError, comeBack])

    useEffect(() => {
        if (awayRef.current && status !== 'ready') comeBack()
    }, [status, comeBack])

    const wasBusy = useRef(false)
    useEffect(() => {
        if (wasBusy.current && !busy) {
            const resume = newerRunRef.current
            newerRunRef.current = false
            refresh({ resume }).catch(() => {})
        }
        wasBusy.current = busy
    }, [busy, refresh])

    const { error } = chat
    useEffect(() => {
        if (!error || !error.message.includes('run_in_flight')) return
        const text = lastSentRef.current
        lastSentRef.current = null
        if (text) refusedRef.current?.(text, runRef.current)
        clearError()
        refresh({ resume: true }).catch(() => {})
    }, [error, clearError, refresh])

    const authorId = me?.user.id
    const send = useCallback(
        (text: string, files?: FileUIPart[], options?: { queued?: boolean }) => {
            setRunStartedAt(Date.now())
            lastSentRef.current = text
            return chat.sendMessage({ text, files, metadata: authorId ? { authorId } : undefined }, options?.queued ? { body: { queued: true } } : undefined)
        },
        [chat, authorId]
    )

    const stop = useCallback(async () => {
        chat.stop()
        const caller = callerRef.current
        const id = sessionRef.current
        if (caller && id) await endpoints.stop(caller, id, runRef.current).catch(() => {})
    }, [chat, endpoints])

    const regenerate = useCallback(() => {
        setRunStartedAt(Date.now())
        return chat.regenerate()
    }, [chat])

    const activeRunId = useCallback(() => runRef.current, [])

    return { messages: chat.messages, status, runStartedAt, activeRunId, regenerate, error: error && !error.message.includes('run_in_flight') ? error : undefined, busy, sessionId, history, fresh, send, stop, retry: () => refresh({ resume: true }).catch(() => setHistory('error')) }
}
