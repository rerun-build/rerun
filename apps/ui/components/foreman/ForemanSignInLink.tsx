'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AuthDialog } from '@/components/dialogs/AuthDialog'

export function ForemanSignInLink() {
    const t = useTranslations('foreman.signInLink')
    const [open, setOpen] = useState(false)

    return (
        <>
            <p className="text-center text-xs text-muted-foreground">
                {t.rich('prompt', {
                    link: chunks => (
                        <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => setOpen(true)}>
                            {chunks}
                        </button>
                    ),
                })}
            </p>

            <AuthDialog variant="signin" open={open} onOpenChange={setOpen} />
        </>
    )
}
