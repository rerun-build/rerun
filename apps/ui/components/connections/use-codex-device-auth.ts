'use client'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { pollCodexDeviceAuthAction, startCodexDeviceAuthAction } from '@/app/api/_actions/workspace-connection.actions'
import { trackAiConnectionFailed } from '@/lib/engine/ai-connection-analytics'
import type { AiConnectionSurface } from '@rerun/analytics'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

export type PendingCodexAuth = { deviceAuthId: string; userCode: string; verificationUrl: string; pollIntervalMs: number; expiresAt: number }

export type CodexDeviceAuthPhase = 'idle' | 'starting' | 'waiting' | 'connected'

export type CodexDeviceAuth = {
    phase: CodexDeviceAuthPhase
    pending: PendingCodexAuth | null
    expired: boolean
    error: string | null
    opening: boolean
    copied: boolean
    // Since the code was handed out, ticking while it waits for OpenAI's approval.
    waitedMs: number
    start: () => Promise<void>
    copy: () => void
}

type KeysHandler = (keys: Record<string, string>) => Promise<{ success: boolean } & Refusal>

// A second click asks OpenAI for a second code and opens a second tab, the first code then goes
// nowhere.
const OPEN_LOCK_MS = 5000

// Codex has no pasteable token: the user types a short code on OpenAI's own page while we poll for
// the approval. The direction of the code is the reverse of Claude's — we hand one out instead of
// taking one in.
export function useCodexDeviceAuth(onKeys: KeysHandler, surface: AiConnectionSurface): CodexDeviceAuth {
    const t = useTranslations('connections.errors')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const [pending, setPending] = useState<PendingCodexAuth | null>(null)
    const [busy, setBusy] = useState(false)
    const [connected, setConnected] = useState(false)
    const [expired, setExpired] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [startedAt, setStartedAt] = useState(0)
    const [now, setNow] = useState(0)
    const [opening, setOpening] = useState(false)
    const openingRef = useRef(false)
    // Callers pass an inline handler: keyed on it, the poll would restart on every render above.
    const onKeysRef = useRef(onKeys)
    useEffect(() => {
        onKeysRef.current = onKeys
    }, [onKeys])

    const start = useCallback(async () => {
        if (openingRef.current) return
        openingRef.current = true
        setOpening(true)
        const lock = new Promise(resolve => setTimeout(resolve, OPEN_LOCK_MS))
        setError(null)
        setExpired(false)
        setConnected(false)
        setBusy(true)
        try {
            const next = await startCodexDeviceAuthAction()
            setPending(next)
            setStartedAt(Date.now())
            setNow(Date.now())
            window.open(next.verificationUrl, '_blank', 'noopener,noreferrer')
        } catch (err) {
            setError(err instanceof Error ? err.message : t('startFailed'))
            trackAiConnectionFailed('codex', 'oauth', surface, 'start_failed', err instanceof Error ? err.message : 'Could not start the connection')
        } finally {
            setBusy(false)
            await lock
            openingRef.current = false
            setOpening(false)
        }
    }, [surface, t])

    const copy = useCallback(() => {
        if (!pending) return
        void navigator.clipboard.writeText(pending.userCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [pending])

    useEffect(() => {
        if (!pending) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [pending])

    // Poll until the user approves, the request expires, or the row unmounts. `cancelled` guards the
    // in-flight action so a late resolution cannot revive a torn-down flow.
    useEffect(() => {
        if (!pending) return
        let cancelled = false

        const timer = setInterval(async () => {
            if (Date.now() > pending.expiresAt) {
                clearInterval(timer)
                if (!cancelled) {
                    setPending(null)
                    setExpired(true)
                    setError(t('codeExpired'))
                    trackAiConnectionFailed('codex', 'oauth', surface, 'code_expired')
                }
                return
            }
            // A poll that failed to reach the server is retried on the next tick, like a pending one.
            const res = await pollCodexDeviceAuthAction(pending.deviceAuthId, pending.userCode).catch(() => ({ status: 'pending' as const }))
            if (cancelled || res.status === 'pending') return
            clearInterval(timer)
            if (res.status === 'error') {
                setPending(null)
                setError(errorText(res))
                trackAiConnectionFailed('codex', 'oauth', surface, 'device_auth_failed', res.error)
                return
            }
            const applied = await onKeysRef.current(res.keys).catch(() => ({ success: false, error: tCommon('somethingWentWrong') }))
            if (cancelled) return
            setPending(null)
            if (applied.success) setConnected(true)
            else setError(errorText(applied, t('saveConnectionFailed')))
        }, pending.pollIntervalMs)

        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [pending, surface, t, tCommon, errorText])

    const phase: CodexDeviceAuthPhase = connected ? 'connected' : pending ? 'waiting' : busy ? 'starting' : 'idle'

    return { phase, pending, expired, error, opening, copied, waitedMs: pending ? now - startedAt : 0, start, copy }
}
