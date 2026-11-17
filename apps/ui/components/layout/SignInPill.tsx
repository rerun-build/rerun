'use client'

import { ChromePill } from '@rerun/ui/chrome'
import { LogInIcon } from '@/lib/icons'
import { routes } from '@/lib/routes'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

// The way to the sign-in from a page a visitor may open without an account (an unsubscribe link).
export function SignInPillButton() {
    const t = useTranslations('layout')
    const router = useRouter()

    return (
        <ChromePill start="icon" onClick={() => router.push(routes.auth)}>
            <LogInIcon className="size-4 text-muted-foreground shrink-0" />
            {t('signIn')}
        </ChromePill>
    )
}
