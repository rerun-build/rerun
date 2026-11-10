'use client'

import { Button } from '@/components/ui/button'
import { redirectPendingSignInPopup } from '@/components/services/sign-in-popup'
import { useOAuthPopupResult } from '@/hooks/useOAuthPopupResult'
import { usePopupClosePoll } from '@/hooks/usePopupClosePoll'
import { CheckCircle2Icon, ExternalLinkIcon, Loader2Icon, XCircleIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

const RESULT_TYPES = ['mcp-oauth-success', 'mcp-oauth-error'] as const

type McpOAuthAuthorizeProps = {
    url: string
    agentId: string
    serverName: string
    onAuthorized: () => void
    // Starts the sign-in at mount, in the window the caller opened inside its click handler.
    autoStart?: boolean
    pendingPopup?: Window | null
}

type OAuthState = 'idle' | 'discovering' | 'ready' | 'authorizing' | 'authorized' | 'error'

type DiscoveryResult = {
    metadata: Record<string, unknown>
    clientInfo: Record<string, unknown> | null
}

export function McpOAuthAuthorize({ url, agentId, serverName, onAuthorized, autoStart, pendingPopup }: McpOAuthAuthorizeProps) {
    const t = useTranslations('agent.mcpOAuthAuthorize')
    const [state, setState] = useState<OAuthState>('idle')
    const [error, setError] = useState<string | null>(null)
    const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null)
    const popupRef = useRef<Window | null>(null)

    const discover = useCallback(async () => {
        if (!url.trim()) return
        setState('discovering')
        setError(null)
        try {
            const res = await fetch('/api/mcp/oauth/discover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || t('discoveryFailed'))
            setDiscovery(data)
            setState('ready')
        } catch (err) {
            pendingPopup?.close()
            setError(err instanceof Error ? err.message : t('discoveryFailed'))
            setState('error')
        }
    }, [url, pendingPopup, t])

    useEffect(() => {
        if (url.trim()) discover()
    }, [discover, url])

    const armResult = useOAuthPopupResult<{ type: string; serverName?: string; error?: string }>('mcp-oauth', RESULT_TYPES, data => {
        if (data.type === 'mcp-oauth-success') {
            setState('authorized')
            onAuthorized()
        } else {
            setError(data.error || t('authorizationFailed'))
            setState('error')
        }
        popupRef.current?.close()
    }, data => !data.serverName || data.serverName === serverName)

    const watchPopup = usePopupClosePoll(() => setState(s => (s === 'authorizing' ? 'ready' : s)))

    const startAuth = async () => {
        if (!discovery) return
        setState('authorizing')
        setError(null)
        armResult()
        try {
            const res = await fetch('/api/mcp/oauth/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId,
                    serverName,
                    mcpUrl: url,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || t('startFailed'))

            const w = 500
            const h = 600
            const left = window.screenX + (window.outerWidth - w) / 2
            const top = window.screenY + (window.outerHeight - h) / 2
            popupRef.current =
                redirectPendingSignInPopup(pendingPopup, data.authorizationUrl) ??
                window.open(
                    data.authorizationUrl,
                    'mcp-oauth',
                    `width=${w},height=${h},left=${left},top=${top},popup=yes`,
                )
            watchPopup(popupRef.current)
        } catch (err) {
            pendingPopup?.close()
            setError(err instanceof Error ? err.message : t('startFailed'))
            setState('error')
        }
    }

    const autoStartedRef = useRef(false)
    useEffect(() => {
        if (!autoStart || state !== 'ready' || autoStartedRef.current || !pendingPopup || pendingPopup.closed) return
        autoStartedRef.current = true
        startAuth()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStart, state])

    if (state === 'discovering') {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                <Loader2Icon className="size-3.5 animate-spin" />
                <span>{t('discovering')}</span>
            </div>
        )
    }

    if (state === 'authorized') {
        return (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 py-1">
                <CheckCircle2Icon className="size-3.5" />
                <span>{t('connected')}</span>
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
                <Button variant="outline" size="sm" onClick={discover}>
                    {t('retry')}
                </Button>
            </div>
        )
    }

    if (state === 'ready' || state === 'authorizing') {
        return (
            <Button
                variant="outline"
                size="sm"
                onClick={startAuth}
                disabled={state === 'authorizing'}
                className="w-full"
            >
                {state === 'authorizing' ? (
                    <Loader2Icon className="size-3.5 animate-spin mr-1.5" />
                ) : (
                    <ExternalLinkIcon className="size-3.5 mr-1.5" />
                )}
                {state === 'authorizing' ? t('waiting') : t('connect')}
            </Button>
        )
    }

    return null
}
