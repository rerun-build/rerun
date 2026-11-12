'use client'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { redirectPendingSignInPopup } from '@/components/services/sign-in-popup'
import { useOAuthPopupResult } from '@/hooks/useOAuthPopupResult'
import { usePopupClosePoll } from '@/hooks/usePopupClosePoll'
import { CheckCircle2Icon, ExternalLinkIcon, Loader2Icon, ShieldCheck, XCircleIcon } from '@/lib/icons'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { desktopServiceSignInAvailable, signInThroughBrowser } from '@/lib/desktop-shell/service-sign-in'

const RESULT_TYPES = ['composio-oauth-success', 'composio-oauth-error'] as const

type ComposioConnectProps = {
    agentId: string
    // The registry key of the account being connected: the slug, or `slug@id` for another account.
    instanceKey: string
    name: string
    onAuthorized: (accountLabel?: string) => void
    // Starts the sign-in at mount, in the window the caller opened inside its click handler.
    autoStart?: boolean
    pendingPopup?: Window | null
}

type ConnectState = 'idle' | 'authorizing' | 'authorized' | 'error'

// Connect a Composio service: the popup runs Composio's hosted sign-in, the callback verifies
// the connected account server-side, and here we only drive the popup and react to its result
// over a same-origin BroadcastChannel (survives COOP-severed openers).
export function ComposioConnect({ agentId, instanceKey, name, onAuthorized, autoStart, pendingPopup }: ComposioConnectProps) {
    const t = useTranslations('services.connect')
    const [state, setState] = useState<ConnectState>('idle')
    const [accountLabel, setAccountLabel] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const popupRef = useRef<Window | null>(null)

    const armResult = useOAuthPopupResult<{ type: string; key?: string; accountLabel?: string; error?: string }>('composio-oauth', RESULT_TYPES, data => {
        if (data.type === 'composio-oauth-success') {
            setAccountLabel(data.accountLabel ?? null)
            setState('authorized')
            onAuthorized(data.accountLabel)
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
        if (desktopServiceSignInAvailable()) {
            const result = await signInThroughBrowser({ agentId, key: instanceKey }, t('authorizationFailed'))
            if (result.ok) {
                setState('authorized')
                onAuthorized()
            } else {
                setError(result.error)
                setState('error')
            }
            return
        }
        armResult()
        try {
            const res = await fetch('/api/oauth/composio/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, key: instanceKey }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || t('startFailed'))

            const w = 500
            const h = 640
            const left = window.screenX + (window.outerWidth - w) / 2
            const top = window.screenY + (window.outerHeight - h) / 2
            popupRef.current = redirectPendingSignInPopup(pendingPopup, data.authorizationUrl) ?? window.open(data.authorizationUrl, 'composio-oauth', `width=${w},height=${h},left=${left},top=${top},popup=yes`)
            watchPopup(popupRef.current)
        } catch (err) {
            pendingPopup?.close()
            setError(err instanceof Error ? err.message : t('startFailed'))
            setState('error')
        }
    }

    const autoStartedRef = useRef(false)
    useEffect(() => {
        if (!autoStart || autoStartedRef.current || (!desktopServiceSignInAvailable() && (!pendingPopup || pendingPopup.closed))) return
        autoStartedRef.current = true
        startAuth()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (state === 'authorized') {
        return (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 py-1">
                <CheckCircle2Icon className="size-3.5" />
                <span>{accountLabel ? t('connectedAs', { account: accountLabel }) : t('connected')}</span>
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
        <div className="space-y-2">
            <Alert variant="warning" stripes className="grid-cols-[auto_1fr] gap-x-3 gap-y-0">
                <Icon icon={ShieldCheck} size="sm" className="row-span-2 self-center" />
                <AlertTitle className="col-start-2 leading-tight">{t('secureTitle')}</AlertTitle>
                <AlertDescription className="col-start-2 leading-snug">{t('secureBody')}</AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" onClick={startAuth} disabled={state === 'authorizing'} className="w-full">
                {state === 'authorizing' ? <Loader2Icon className="size-3.5 animate-spin mr-1.5" /> : <ExternalLinkIcon className="size-3.5 mr-1.5" />}
                {state === 'authorizing' ? t('waiting') : t('connect')}
            </Button>
        </div>
    )
}
