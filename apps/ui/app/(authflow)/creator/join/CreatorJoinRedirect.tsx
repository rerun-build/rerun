'use client'

import { Button } from '@/components/ui/button'
import { writePendingInviteCookie } from '@/lib/auth/pending-invite'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { JoinCard } from './JoinShell'

// Same handoff as the workspace invite: the cookie survives the round trip through Google, which
// drops the query string, and `/auth/callback` reads it back as the destination.
export function CreatorJoinRedirect({ token, name, email }: { token: string; name: string; email: string | null }) {
    const t = useTranslations('auth.creatorJoin')
    const next = `/creator/join/${token}`
    const authUrl = `/auth?${email ? `email=${encodeURIComponent(email)}&` : ''}next=${encodeURIComponent(next)}`

    useEffect(() => {
        writePendingInviteCookie(next)
        window.location.href = authUrl
    }, [authUrl, next])

    return (
        <JoinCard>
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{t('redirect.title', { name })}</h1>
                <p className="text-sm text-muted-foreground">{email ? t('redirect.messageWithEmail', { email }) : t('redirect.message')}</p>
            </div>
            <Button className="w-full" onClick={() => (window.location.href = authUrl)}>
                {t('redirect.continue')}
            </Button>
        </JoinCard>
    )
}
