'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CopyLine } from '@/components/dialogs/CopyLine'
import { writeAuthReturnCookie } from '@/lib/auth/auth-return'
import { ENABLED_OAUTH_PROVIDERS } from '@/lib/auth/oauth-providers'
import { startOAuthSignIn } from '@/lib/auth/oauth-sign-in'
import { createClient } from '@/supabase/client'
import { DESKTOP_APP_COOKIE, DESKTOP_AUTH_CALLBACK_HOST, DESKTOP_AUTH_CALLBACK_PATH, desktopShellScheme, type DesktopShellChannel, type DesktopSignInProvider } from '@rerun/contracts'
import { Skeleton } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { approveDesktopSignIn } from './actions'

const APP_NAMES: Record<DesktopShellChannel, string> = { stable: 'Rerun', staging: 'Rerun Staging', dev: 'Rerun Dev' }

type Props = { challenge: string; state: string; channel: DesktopShellChannel; provider: DesktopSignInProvider | null; account: string | null }

function signInRoute(): string {
    return `${window.location.pathname}${window.location.search}`
}

// Signed out: straight to the provider the app's button named, or to the sign-in page, and back here.
function useSignInFirst(signedIn: boolean, provider: DesktopSignInProvider | null) {
    useEffect(() => {
        if (signedIn) return
        const back = signInRoute()
        writeAuthReturnCookie(back)
        if (provider && ENABLED_OAUTH_PROVIDERS.includes(provider)) void startOAuthSignIn(provider)
        else window.location.replace(`/auth?next=${encodeURIComponent(back)}`)
    }, [signedIn, provider])
}

export function DesktopHandoff({ challenge, state, channel, provider, account }: Props) {
    const t = useTranslations('desktopShell.handoff')
    const [status, setStatus] = useState<'confirm' | 'approving' | 'done' | 'failed'>('confirm')
    const [code, setCode] = useState<string | null>(null)
    const [switching, setSwitching] = useState(false)
    useSignInFirst(account !== null, provider)
    const app = APP_NAMES[channel]

    if (account === null) {
        return (
            <Card className="space-y-3 p-8">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-10 w-full" />
            </Card>
        )
    }

    const approve = async () => {
        setStatus('approving')
        const approval = await approveDesktopSignIn(challenge)
        if (!approval.ok) {
            if (approval.reason === 'signed-out') window.location.reload()
            setStatus('failed')
            return
        }
        setCode(approval.code)
        setStatus('done')
        // This browser now offers to open Rerun's pages in the app (OpenInDesktopPrompt).
        document.cookie = `${DESKTOP_APP_COOKIE}=${channel}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
        const link = new URL(`${desktopShellScheme(channel)}://${DESKTOP_AUTH_CALLBACK_HOST}${DESKTOP_AUTH_CALLBACK_PATH}`)
        link.searchParams.set('code', approval.code)
        link.searchParams.set('state', state)
        window.location.href = link.toString()
    }

    const switchAccount = async () => {
        setSwitching(true)
        await createClient().auth.signOut()
        window.location.href = `/auth?next=${encodeURIComponent(signInRoute())}`
    }

    if (status === 'done' && code) {
        return (
            <Card className="space-y-4 p-8">
                <div className="space-y-2">
                    <h2 className="text-xl font-semibold tracking-tight">{t('doneTitle', { app })}</h2>
                    <p className="text-sm text-muted-foreground">{t('doneBody', { app })}</p>
                </div>
                <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{t('codeHint', { app })}</p>
                    <CopyLine value={code} label={t('copyCode')} />
                </div>
            </Card>
        )
    }

    return (
        <Card className="space-y-6 p-8">
            <div className="space-y-2">
                <h2 className="text-xl font-semibold tracking-tight">{t('title', { app })}</h2>
                <p className="text-sm text-muted-foreground break-words">{t('body', { app, account })}</p>
                {status === 'failed' && <p className="text-sm text-destructive">{t('failed')}</p>}
            </div>
            <div className="flex flex-col gap-2">
                <Button className="w-full" onClick={() => void approve()} loading={status === 'approving'}>
                    {t('continue')}
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => void switchAccount()} loading={switching}>
                    {t('switchAccount')}
                </Button>
            </div>
        </Card>
    )
}
