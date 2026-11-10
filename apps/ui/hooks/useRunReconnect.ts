'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type RefObject } from 'react'

// How many times a dropped stream is chased before the run is called dead.
const RECONNECT_ATTEMPTS = 5

type RunStatus = { status: string; error?: string | null }

// What one reconnection works on, captured when the stream drops: the conversation can change under
// a chase that takes a minute, and it has to finish on the one it started with.
export type RunReconnectTarget = {
    runId: string
    getRun: () => Promise<RunStatus | null>
    fetchMessages: () => Promise<unknown[]>
    onSettled: (outcome: { errored: boolean; errorText: string | null }) => Promise<void> | void
}

type RunReconnectOptions = {
    error: Error | undefined
    // Set by the chat's own onFinish when a stream closed normally.
    completedRef: RefObject<boolean>
    // Null when there is no run to chase: the error is then a plain failure, shown as it is.
    start: () => RunReconnectTarget | null
    resumeStream: () => Promise<void>
    setMessages: (messages: never[]) => void
    clearError: () => void
}

// When a long run's HTTP stream is severed mid-flight (the engine keeps running and persists the
// result), don't surface a dead "network error": re-attach to the still-running run and resume
// streaming the tokens live in the same assistant message. If the run already finished (no live
// stream to resume), fall back to reloading the persisted messages.
export function useRunReconnect({ error, completedRef, start, resumeStream, setMessages, clearError }: RunReconnectOptions): boolean {
    const t = useTranslations('chat.agentChat')
    const [reconnecting, setReconnecting] = useState(false)
    const reconnectingRef = useRef(false)
    const mountedRef = useRef(true)
    const startRef = useRef(start)
    useEffect(() => {
        startRef.current = start
    })

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    useEffect(() => {
        if (!error || reconnectingRef.current) return
        const target = startRef.current()
        if (!target) return
        reconnectingRef.current = true
        setReconnecting(true)
        completedRef.current = false
        const failureMessage = error.message
        ;(async () => {
            let errored = false
            let errorText: string | null = null
            try {
                // Bounded on purpose: a run whose provider wedged answers "running" forever, and an
                // unbounded loop kept the conversation spinning with no way out.
                for (let attempt = 0; attempt < RECONNECT_ATTEMPTS && mountedRef.current; attempt++) {
                    await resumeStream().catch(() => {})
                    if (!mountedRef.current || completedRef.current) break
                    let finished = false
                    for (let i = 0; i < 3 && mountedRef.current; i++) {
                        const run = await target.getRun().catch(() => null)
                        if (completedRef.current) {
                            finished = true
                            break
                        }
                        if (!run || run.status !== 'running') {
                            finished = true
                            errored = run?.status === 'error'
                            // A genuine terminal failure (e.g. missing API key): surface
                            // the engine's authoritative error instead of silently
                            // reconnecting. Only `status === 'running'` is a recoverable drop.
                            if (errored) errorText = run?.error ?? failureMessage
                            break
                        }
                        await new Promise(r => setTimeout(r, 1000))
                    }
                    if (finished) break
                    if (attempt === RECONNECT_ATTEMPTS - 1) {
                        errored = true
                        errorText = t('runStoppedResponding')
                    }
                }
                if (!mountedRef.current) return
                if (!completedRef.current) {
                    const data = await target.fetchMessages().catch(() => [])
                    if (data.length > 0) setMessages(data as never[])
                }
                await target.onSettled({ errored, errorText })
                setReconnecting(false)
                clearError()
            } finally {
                reconnectingRef.current = false
            }
        })()
    }, [error, completedRef, setMessages, clearError, resumeStream, t])

    return reconnecting
}
