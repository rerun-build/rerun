'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createClient } from '@/supabase/client'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function InviteMismatch({ inviteEmail, currentEmail, workspaceName }: { inviteEmail: string; currentEmail: string; workspaceName: string }) {
    const t = useTranslations('auth.invite')
    const [loading, setLoading] = useState(false)
    const supabase = createClient()

    const switchAccount = async () => {
        setLoading(true)
        await supabase.auth.signOut()
        window.location.href = `/auth?email=${encodeURIComponent(inviteEmail)}&next=${encodeURIComponent(window.location.pathname)}`
    }

    return (
        <Card className="space-y-4 p-8">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{t('mismatch.title')}</h1>
                <p className="text-sm text-muted-foreground">
                    {t.rich('mismatch.message', { workspace: workspaceName, inviteEmail, currentEmail, strong: chunks => <strong>{chunks}</strong> })}
                </p>
            </div>
            <Button className="w-full" onClick={switchAccount} loading={loading}>
                {t('mismatch.switch', { email: inviteEmail })}
            </Button>
        </Card>
    )
}
