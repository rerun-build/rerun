'use client'

import { Button } from '@/components/ui/button'
import { LogOutIcon } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

// The way out of an account opened by mistake: until its onboarding is done every page leads back to
// it, and the desktop app has no address bar to leave by.
export function WelcomeSignOutButton() {
    const t = useTranslations('layout.workspaceMenu')
    const { signOut } = useSession()
    const [signingOut, setSigningOut] = useState(false)

    const leave = async () => {
        setSigningOut(true)
        await signOut()
    }

    return (
        <Button variant="ghost" className="text-muted-foreground" loading={signingOut} onClick={() => void leave()}>
            <LogOutIcon />
            {t('signOut')}
        </Button>
    )
}
