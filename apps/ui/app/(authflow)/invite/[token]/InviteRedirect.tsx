'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { writePendingInviteCookie } from '@/lib/auth/pending-invite'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

export function InviteRedirect({ next, email, title, message }: { next: string; email: string; title: string; message: string }) {
    const t = useTranslations('auth.invite')
    const authUrl = `/auth?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`

    useEffect(() => {
        writePendingInviteCookie(next)
        window.location.href = authUrl
    }, [authUrl, next])

    return (
        <Card className="space-y-4 p-8">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            <Button className="w-full" onClick={() => (window.location.href = authUrl)}>
                {t('redirect.continue')}
            </Button>
        </Card>
    )
}
