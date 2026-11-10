'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { writePendingInviteCookie } from '@/lib/auth/pending-invite'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

export function InviteRedirect({ token, email, workspaceName }: { token: string; email: string; workspaceName: string }) {
    const t = useTranslations('auth.invite')
    const next = `/invite/${token}`
    const authUrl = `/auth?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`

    useEffect(() => {
        writePendingInviteCookie(next)
        window.location.href = authUrl
    }, [authUrl, next])

    return (
        <Card className="space-y-4 p-8">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{t('redirect.title', { workspace: workspaceName })}</h1>
                <p className="text-sm text-muted-foreground">{t('redirect.message', { email })}</p>
            </div>
            <Button className="w-full" onClick={() => (window.location.href = authUrl)}>
                {t('redirect.continue')}
            </Button>
        </Card>
    )
}
