'use client'

import { AuthDialog } from '@/components/dialogs/AuthDialog'
import { ChromePill } from '@rerun/ui/chrome'
import { LogInIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function SignInPillButton() {
    const t = useTranslations('layout')
    const [open, setOpen] = useState(false)

    return (
        <>
            <ChromePill start="icon" onClick={() => setOpen(true)}>
                <LogInIcon className="size-4 text-muted-foreground shrink-0" />
                {t('signIn')}
            </ChromePill>

            <AuthDialog variant="signin" open={open} onOpenChange={setOpen} />
        </>
    )
}
