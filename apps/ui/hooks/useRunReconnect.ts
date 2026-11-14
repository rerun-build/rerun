'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type RefObject } from 'react'

const RECONNECT_ATTEMPTS = 5

type RunStatus = { status: string; error?: string | null }

export type RunReconnectTarget = {
    runId: string
    getRun: () => Promise<RunStatus | null>
    fetchMessages: () => Promise<unknown[]>
    onSettled: (outcome: { errored: boolean; errorText: string | null }) => Promise<void> | void
}

type RunReconnectOptions = {
    error: Error | undefined
    completedRef: RefObject<boolean>
    start: () => RunReconnectTarget | null
    resumeStream: () => Promise<void>
    setMessages: (messages: never[]) => void
    clearError: () => void
}

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
