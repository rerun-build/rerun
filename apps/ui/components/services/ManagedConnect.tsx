'use client'

import { Button } from '@/components/ui/button'
import { redirectPendingSignInPopup } from '@/components/services/sign-in-popup'
import { useOAuthPopupResult } from '@/hooks/useOAuthPopupResult'
import { usePopupClosePoll } from '@/hooks/usePopupClosePoll'
import { CheckCircle2Icon, ExternalLinkIcon, Loader2Icon, XCircleIcon } from '@/lib/icons'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

const RESULT_TYPES = ['managed-oauth-success', 'managed-oauth-error'] as const

type ManagedConnectProps = {
    agentId: string
    // The registry key of the account being connected: the slug, or `slug@id` for another account.
    instanceKey: string
    provider: string
    serverName: string
    name: string
    onAuthorized: (accountEmail?: string) => void
    // Starts the sign-in at mount, in the window the caller opened inside its click handler.
    autoStart?: boolean
    pendingPopup?: Window | null
}

type ConnectState = 'idle' | 'authorizing' | 'authorized' | 'error'

// Connect a managed service: Rerun brokers the OAuth (one app) in a popup, then runs the
// provider's API calls itself. The token lands on the engine; here we only drive the popup and
// react to its result over a same-origin BroadcastChannel (survives COOP-severed openers).
export function ManagedConnect({ agentId, instanceKey, provider, serverName, name, onAuthorized, autoStart, pendingPopup }: ManagedConnectProps) {
    const t = useTranslations('services.connect')
    const [state, setState] = useState<ConnectState>('idle')
    const [email, setEmail] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const popupRef = useRef<Window | null>(null)

    const armResult = useOAuthPopupResult<{ type: string; key?: string; email?: string; error?: string }>('managed-oauth', RESULT_TYPES, data => {
        if (data.type === 'managed-oauth-success') {
            setEmail(data.email ?? null)
            setState('authorized')
            onAuthorized(data.email)
        } else {
            setError(data.error || t('authorizationFailed'))
            setState('error')
        }
        popupRef.current?.close()
    }, data => !data.key || data.key === instanceKey)

    const watchPopup = usePopupClosePoll(() => setState(s => (s === 'authorizing' ? 'idle' : s)))

    const startAuth = async () => {
        setState('authorizing')
        setError(null)
        armResult()
        try {
            const res = await fetch(`/api/oauth/managed/${provider}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, key: instanceKey, serverName }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || t('startOAuthFailed'))

            const w = 500
            const h = 640
            const left = window.screenX + (window.outerWidth - w) / 2
            const top = window.screenY + (window.outerHeight - h) / 2
            popupRef.current = redirectPendingSignInPopup(pendingPopup, data.authorizationUrl) ?? window.open(data.authorizationUrl, 'managed-oauth', `width=${w},height=${h},left=${left},top=${top},popup=yes`)
            watchPopup(popupRef.current)
        } catch (err) {
            pendingPopup?.close()
            setError(err instanceof Error ? err.message : t('startOAuthFailed'))
            setState('error')
        }
    }

    const autoStartedRef = useRef(false)
    useEffect(() => {
        if (!autoStart || autoStartedRef.current || !pendingPopup || pendingPopup.closed) return
        autoStartedRef.current = true
        startAuth()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (state === 'authorized') {
        return (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 py-1">
                <CheckCircle2Icon className="size-3.5" />
                <span>{email ? t('connectedAs', { account: email }) : t('connected')}</span>
            </div>
        )
    }

    if (state === 'error') {
        return (
            <div className="space-y-2 py-1">
                <div className="flex items-center gap-2 text-sm text-destructive">
                    <XCircleIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{error}</span>
                </div>
                <Button variant="outline" size="sm" onClick={startAuth}>
                    {t('retry')}
                </Button>
            </div>
        )
    }

    return (
        <Button variant="outline" size="sm" onClick={startAuth} disabled={state === 'authorizing'} className="w-full">
            {state === 'authorizing' ? <Loader2Icon className="size-3.5 animate-spin mr-1.5" /> : <ExternalLinkIcon className="size-3.5 mr-1.5" />}
            {state === 'authorizing' ? t('waiting') : t('connect')}
        </Button>
    )
}
