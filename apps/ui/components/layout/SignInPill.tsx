'use client'

import { routes } from '@/lib/routes'
import { ChromePill } from '@rerun/ui/chrome'
import { LogInIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

// Sign-in entry on the pages that sit outside the app shell, for a visitor without an account. The
// caller places it.
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
