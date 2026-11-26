'use client'

import { pollGrokSignInAction, startGrokSignInAction } from '@/app/api/_actions/workspace-connection.actions'
import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { trackAiConnectionFailed } from '@/lib/engine/ai-connection-analytics'
import type { AiConnectionSurface } from '@rerun/analytics'
import { GROK_SLOW_DOWN_STEP_MS, type GrokSignInStart } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

export type GrokDeviceAuthPhase = 'idle' | 'starting' | 'waiting' | 'connected'

export type GrokDeviceAuth = {
    phase: GrokDeviceAuthPhase
    pending: GrokSignInStart | null
    expired: boolean
    error: string | null
    opening: boolean
    copied: boolean
    start: () => Promise<void>
    copy: () => void
}

// Where the approval lands: a new connection under a name, or the connection being signed in again.
export type GrokSignInTarget = { connectionId?: string; name?: string }

type ConnectedHandler = (connectionId: string) => Promise<{ success: boolean } & Refusal>

// A second click asks xAI for a second code and opens a second tab, the first code then goes nowhere.
const OPEN_LOCK_MS = 5000

// What ends the wait for good: xAI's answer, or a refusal of the hub no retry changes. Anything else
// (the hub or its database out of reach for a moment) is polled through, so an approval given on
// xAI's page meanwhile is still picked up, up to this many failures in a row.
const FINAL_REFUSALS: ReadonlySet<string> = new Set(['grokSignInDenied', 'grokSignInExpired', 'grokSignInNotStored', 'grokNeedsUpdate', 'signInOtherProvider', 'adminOnlyAiProviders', 'trialToConnectModel', 'managedWorkspacePaused'])
const MAX_FAILED_POLLS = 6

// The person types a short code on xAI's own page while the hub polls. Unlike Codex's flow, the hub
// stores the connection itself the moment xAI approves: what comes back here is its id, never a key.
export function useGrokDeviceAuth(onConnected: ConnectedHandler, surface: AiConnectionSurface, target: GrokSignInTarget): GrokDeviceAuth {
    const t = useTranslations('connections.errors')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const [pending, setPending] = useState<GrokSignInStart | null>(null)
    const [busy, setBusy] = useState(false)
    const [connected, setConnected] = useState(false)
    const [expired, setExpired] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [opening, setOpening] = useState(false)
    const openingRef = useRef(false)
    // Callers pass inline values: keyed on them, the poll would restart on every render above.
    const onConnectedRef = useRef(onConnected)
    const targetRef = useRef(target)
    useEffect(() => {
        onConnectedRef.current = onConnected
        targetRef.current = target
    }, [onConnected, target])

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
            const next = await startGrokSignInAction()
            if (!next.ok) {
                setError(errorText(next, t('startFailed')))
                trackAiConnectionFailed('grok', 'oauth', surface, 'start_failed', next.error)
                return
            }
            const { ok: _ok, ...started } = next
            setPending(started)
            window.open(started.verificationUrl, '_blank', 'noopener,noreferrer')
        } catch {
            setError(t('startFailed'))
            trackAiConnectionFailed('grok', 'oauth', surface, 'start_failed', 'Could not start the connection')
        } finally {
            setBusy(false)
            await lock
            openingRef.current = false
            setOpening(false)
        }
    }, [surface, t, errorText])

    const copy = useCallback(() => {
        if (!pending) return
        void navigator.clipboard.writeText(pending.userCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [pending])

    // Poll until the person approves, the code expires, or the row unmounts. Each poll is armed once
    // the one before has answered, so two never cross, and `cancelled` guards the in-flight action so
    // a late answer cannot revive a torn-down flow.
    useEffect(() => {
        if (!pending) return
        let cancelled = false
        let failedPolls = 0
        let interval = pending.pollIntervalMs
        let timer: ReturnType<typeof setTimeout>

        const poll = async () => {
            if (Date.now() > pending.expiresAt) {
                setPending(null)
                setExpired(true)
                setError(t('codeExpired'))
                trackAiConnectionFailed('grok', 'oauth', surface, 'code_expired')
                return
            }
            // A poll that failed to reach the server is tried again at the next one, and counts for nothing.
            const res = await pollGrokSignInAction({ ticket: pending.ticket, ...targetRef.current }).catch(() => null)
            if (cancelled) return
            if (res?.status === 'pending') {
                failedPolls = 0
                if (res.slowDown) interval += GROK_SLOW_DOWN_STEP_MS
            }
            const passing = res?.status === 'error' && !FINAL_REFUSALS.has(res.code ?? '') && res.reason !== 'no_plan' && ++failedPolls < MAX_FAILED_POLLS
            if (!res || res.status === 'pending' || passing) {
                timer = setTimeout(poll, interval)
                return
            }
            setPending(null)
            if (res.status === 'error') {
                setError(errorText(res))
                trackAiConnectionFailed('grok', 'oauth', surface, 'device_auth_failed', res.error)
                return
            }
            const applied = await onConnectedRef.current(res.connectionId).catch(() => ({ success: false, error: tCommon('somethingWentWrong') }))
            if (cancelled) return
            if (applied.success) setConnected(true)
            else setError(errorText(applied, t('saveConnectionFailed')))
        }

        timer = setTimeout(poll, interval)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [pending, surface, t, tCommon, errorText])

    const phase: GrokDeviceAuthPhase = connected ? 'connected' : pending ? 'waiting' : busy ? 'starting' : 'idle'

    return { phase, pending, expired, error, opening, copied, start, copy }
}
