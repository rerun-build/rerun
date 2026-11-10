'use client'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { exchangeClaudeSubscriptionAction, startClaudeOAuthAction } from '@/app/api/_actions/workspace-connection.actions'
import { trackAiConnectionFailed } from '@/lib/engine/ai-connection-analytics'
import type { AiConnectionSurface } from '@rerun/analytics'
import { claudeTokenIssue } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useRef, useState } from 'react'

export type ClaudeOAuthPhase = 'idle' | 'waiting' | 'checking' | 'connected'

export type ClaudeOAuth = {
    phase: ClaudeOAuthPhase
    error: string | null
    opening: boolean
    start: () => Promise<void>
    // A code Claude showed (exchanged against the armed flow) or a `claude setup-token` token.
    submit: (text: string) => Promise<boolean>
}

type KeysHandler = (keys: Record<string, string>) => Promise<{ success: boolean } & Refusal>

// A second click re-arms the flow and opens a second Claude tab: the code pasted from the first one
// is then refused, and Safari iOS can cut the request short.
const OPEN_LOCK_MS = 5000

// "Open Claude" arms a PKCE flow and opens Claude's authorization page in a new tab; the code Claude
// shows comes back through `submit`. A token pasted by hand skips the exchange.
export function useClaudeOAuth(onKeys: KeysHandler, surface: AiConnectionSurface): ClaudeOAuth {
    const t = useTranslations('connections.errors')
    const tCommon = useTranslations('common')
    const tErrors = useTranslations('errors')
    const errorText = useErrorText()
    const [pkce, setPkce] = useState<{ verifier: string; state: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const [connected, setConnected] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [opening, setOpening] = useState(false)
    const openingRef = useRef(false)

    const start = useCallback(async () => {
        if (openingRef.current) return
        openingRef.current = true
        setOpening(true)
        const lock = new Promise(resolve => setTimeout(resolve, OPEN_LOCK_MS))
        setError(null)
        setConnected(false)
        try {
            const { authorizeUrl, verifier, state } = await startClaudeOAuthAction()
            setPkce({ verifier, state })
            window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
        } catch {
            setError(t('startFailed'))
            trackAiConnectionFailed('claude', 'oauth', surface, 'start_failed')
        } finally {
            await lock
            openingRef.current = false
            setOpening(false)
        }
    }, [surface, t])

    const apply = useCallback(
        async (keys: Record<string, string>) => {
            try {
                const res = await onKeys(keys)
                if (!res.success) {
                    setError(errorText(res, t('saveTokenFailed')))
                    return false
                }
                setPkce(null)
                setConnected(true)
                return true
            } catch {
                setError(tCommon('somethingWentWrong'))
                return false
            }
        },
        [onKeys, t, tCommon, errorText]
    )

    const submit = useCallback(
        async (raw: string) => {
            const text = raw.trim()
            if (!text || busy) return false
            setError(null)
            setConnected(false)

            // A token pasted by hand carries no refresh material, so any left over from an earlier
            // OAuth connect has to go with it — otherwise the engine keeps refreshing against the
            // old lineage. The code Claude shows can only be exchanged by the flow that asked for
            // it: with none armed (a reload, a closed dialog) it falls here too, and is refused.
            if (text.startsWith('sk-ant') || !pkce) {
                const issue = claudeTokenIssue(text)
                if (issue) {
                    setError(tErrors(issue))
                    trackAiConnectionFailed('claude', 'token', surface, 'invalid_token', issue)
                    return false
                }
                setBusy(true)
                const saved = await apply({ CLAUDE_CODE_OAUTH_TOKEN: text })
                setBusy(false)
                return saved
            }

            setBusy(true)
            const exchanged = await exchangeClaudeSubscriptionAction(text, pkce.verifier, pkce.state).catch(() => ({ success: false as const, error: tCommon('somethingWentWrong') }))
            if (!exchanged.success) {
                setBusy(false)
                setError(errorText(exchanged))
                trackAiConnectionFailed('claude', 'oauth', surface, 'oauth_exchange_failed', exchanged.error)
                return false
            }
            const saved = await apply(exchanged.keys)
            setBusy(false)
            return saved
        },
        [busy, pkce, apply, surface, tCommon, tErrors, errorText]
    )

    const phase: ClaudeOAuthPhase = connected ? 'connected' : busy ? 'checking' : pkce ? 'waiting' : 'idle'

    return { phase, error, opening, start, submit }
}
