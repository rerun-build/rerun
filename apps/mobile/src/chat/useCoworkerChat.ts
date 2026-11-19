import { useChat } from '@ai-sdk/react'
import { FOREMAN_KICKOFF_MARKER, messageText } from '@rerun/contracts'
import type { FileUIPart } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '@/auth/AuthProvider'
import { BackgroundGrace } from '@/chat/background-grace'
import type { ChatEndpoints } from '@/chat/endpoints'
import { createChatTransport, type ChatCaller } from '@/chat/transport'
import { loadTranscript, readTranscript, sameTranscript } from '@/data/local-cache'

export type HistoryState = 'loading' | 'ready' | 'error'

// Let go of the stream this long before iOS takes its time back, while the app can still run.
const GRACE_MARGIN_S = 5

// One conversation with a coworker or the Foreman, streamed from the engine through the hub.
// `initialSessionId` is null for a new conversation, which the first send creates; the page keeps its
// chat across that birth instead of starting over.
// `onRefused` gets back a message the engine turned down because a run still held the conversation,
// so it can wait for that run rather than vanish.
// `knownUpdatedAt`: the version of the conversation in the list the app holds. A transcript kept at
// that same version is the hub's own: the conversation opens on it ready to act on.
// `onScreen`: false for a page kept beside the one shown, which reads its transcript again only once
// it comes back on screen.
export function useCoworkerChat({ endpoints, initialSessionId, knownUpdatedAt = null, onScreen = true, onSessionCreated, onRefused }: { endpoints: ChatEndpoints; initialSessionId: string | null; knownUpdatedAt?: string | null; onScreen?: boolean; onSessionCreated?: (sessionId: string) => void; onRefused?: (text: string, behindRunId: string | null) => void }) {
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
    // The transcript kept from the last visit opens the conversation at once; the hub's answer
    // replaces it behind, the way a messaging app opens a thread.
    const [cached] = useState(() => (initialSessionId && me ? readTranscript(me.workspace.id, initialSessionId) : null))
    const [history, setHistory] = useState<HistoryState>(initialSessionId && !cached ? 'loading' : 'ready')
    // False while what is on screen is only the kept transcript: nothing that acts on the run's
    // current state (a question to answer, quick replies) is offered on it, unless it was kept at the
    // version the list of conversations names.
    const [read, setRead] = useState(!initialSessionId)
    const fresh = read || (!!cached?.updatedAt && cached.updatedAt === knownUpdatedAt)
    const [pageId] = useState(() => initialSessionId ?? `new-${endpoints.agentId}-${Date.now()}`)
    // When the run on screen began, for the timer under the last message.
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
    // The refs go to the transport untouched: it reads them when a send leaves, never while rendering.
    // eslint-disable-next-line react-hooks/refs
    const [transport] = useState(() => createChatTransport({ endpoints, sessionRef, runRef, callerRef, onSessionRef, resumeOntoRef, reconnectFailedRef }))

    const chat = useChat({ id: pageId, transport, messages: cached?.messages, experimental_throttle: 80 })
    const { setMessages, resumeStream, status, stop: dropStream, clearError } = chat
    const shownRef = useRef(chat.messages)
    const statusRef = useRef(status)
    // The message the running stream writes: once it has written, the last one on screen is its own.
    const streamedRef = useRef<string | null>(null)
    useEffect(() => {
        shownRef.current = chat.messages
        statusRef.current = status
        if (status === 'submitted') streamedRef.current = null
        if (status !== 'streaming') return
        const last = chat.messages.at(-1)
        streamedRef.current = last?.role === 'assistant' ? last.id : null
    }, [chat.messages, status])

    // The transcript the engine kept is the one to show: it carries what a stream may have dropped.
    const refresh = useCallback(
        async ({ resume }: { resume: boolean }) => {
            const caller = callerRef.current
            const id = sessionRef.current
            if (!caller || !id) return
            // The running run is looked up while the transcript loads; the stream is only picked up
            // once the transcript is in place, since it goes on from the messages already there.
            const [transcript, runId] = await Promise.all([loadTranscript(caller.workspaceId, id, etag => endpoints.messages(caller, id, etag)), resume ? endpoints.activeRun(caller, id).catch(() => null) : null])
            setHistory('ready')
            setRead(true)
            // A send left while the read was on its way: the hub's copy predates it, and the stream
            // on screen is already the one to follow. The end of that run reads the transcript again.
            if (statusRef.current === 'submitted' || statusRef.current === 'streaming') return
            // The hub's copy is set unless it is the very one on screen: a regenerate or a send that
            // failed since left the screen on something else, even when the hub's copy did not move.
            const { messages } = transcript
            if (messages !== shownRef.current && !sameTranscript(messages, shownRef.current)) setMessages(messages)
            if (!runId) return
            runRef.current = runId
            setRunStartedAt(Date.now())
            await resumeStream()
        },
        [endpoints, setMessages, resumeStream]
    )

    // A kept transcript stays on screen when the hub cannot be reached: the error is only for a
    // conversation with nothing to show.
    const failToLoad = useCallback(() => setHistory(current => (current === 'loading' ? 'error' : current)), [])

    useEffect(() => {
        if (!initialSessionId || !me) return
        refresh({ resume: true }).catch(failToLoad)
        // Read once per conversation opened; the caller only has to be there.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSessionId, Boolean(me)])

    // The stream was let go when the app left with a run on screen: the run goes on in the engine and
    // is picked up again on return, so the conversation stays busy in between.
    const [away, setAway] = useState(false)
    const awayRef = useRef(false)
    const busy = status === 'streaming' || status === 'submitted' || away
    const busyRef = useRef(busy)
    useEffect(() => {
        busyRef.current = busy
    }, [busy])
    // Back from the background, only the page on screen reads again at once; one kept beside it does
    // when it is shown.
    const onScreenRef = useRef(onScreen)
    const staleRef = useRef(false)

    const comeBack = useCallback(() => {
        awayRef.current = false
        setAway(false)
    }, [])

    // Set when the run followed on return is no longer the one holding the conversation: the read at
    // the end of the stream then picks the newer one up.
    const newerRunRef = useRef(false)

    // Back with the run's id in hand, its stream is picked up at once, without waiting for the
    // transcript: the replay lands on the message left on screen, and the transcript is read once it ends.
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
        // The hub could not be reached at all: the error it left is not the conversation's, and the
        // transcript read is the one that stays quiet until the network is back.
        if (!reconnectFailedRef.current) return
        clearError()
        newerRunRef.current = false
        await refresh({ resume: true })
    }, [endpoints, refresh, resumeStream, clearError])

    // A stream left open in the background dies of an iOS timeout on return, shown as an error over
    // a transcript that is fine. So the app drops it on its way out, without stopping the run. A
    // conversation not born yet keeps its stream: its id only comes with the response.
    const letGo = useCallback(() => {
        awayRef.current = true
        setAway(true)
        dropStream().catch(() => {})
    }, [dropStream])

    // iOS grants about thirty seconds once the app leaves the screen: the stream stays open through
    // them, so a quick look elsewhere comes back to a conversation that never stopped.
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
                // Kept is false when iOS took its time back first: the app slept and the stream with it.
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
                // Settles once there is nothing left to follow: no run, or the stream it picked up
                // has ended. Before that, the status below takes over.
                rejoin().catch(() => {}).finally(comeBack)
                return
            }
            if (busyRef.current) return
            if (onScreenRef.current) refresh({ resume: true }).catch(() => {})
            else staleRef.current = true
        })
        return () => subscription.remove()
    }, [refresh, rejoin, letGo, endGrace, clearError, comeBack])

    useEffect(() => {
        onScreenRef.current = onScreen
        if (!onScreen || !staleRef.current) return
        staleRef.current = false
        refresh({ resume: true }).catch(() => {})
    }, [onScreen, refresh])

    // The stream picked up again speaks for itself: busy follows the status from here.
    useEffect(() => {
        if (awayRef.current && status !== 'ready') comeBack()
    }, [status, comeBack])

    // Once a stream ends, the stored transcript replaces it: same text, plus the ids and outputs the
    // engine settled on.
    const wasBusy = useRef(false)
    useEffect(() => {
        if (wasBusy.current && !busy) {
            const resume = newerRunRef.current
            newerRunRef.current = false
            refresh({ resume }).catch(() => {})
        }
        wasBusy.current = busy
    }, [busy, refresh])

    // Someone else's message is running in this conversation: follow it rather than show an error.
    const { error } = chat
    useEffect(() => {
        if (!error || !error.message.includes('run_in_flight')) return
        const text = lastSentRef.current
        lastSentRef.current = null
        if (text) refusedRef.current?.(text, runRef.current)
        clearError()
        refresh({ resume: true }).catch(() => {})
    }, [error, clearError, refresh])

    // Signed on the way out, as the web signs it: the avatar shows on the bubble before the
    // transcript comes back with the author the engine stored.
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

    // Sends the last message again, as the web's Try again does.
    const regenerate = useCallback(() => {
        setRunStartedAt(Date.now())
        return chat.regenerate()
    }, [chat])

    // The run holding the conversation, as last named by the hub: what a queued message waits behind.
    const activeRunId = useCallback(() => runRef.current, [])

    // What the app sent for the Chief of Staff to speak first is not theirs to read.
    const messages = useMemo(() => chat.messages.filter(message => message.role !== 'user' || messageText(message).trim() !== FOREMAN_KICKOFF_MARKER), [chat.messages])

    return { messages, status, runStartedAt, activeRunId, regenerate, error: error && !error.message.includes('run_in_flight') ? error : undefined, busy, sessionId, history, fresh, send, stop, retry: () => refresh({ resume: true }).catch(() => setHistory('error')) }
}
