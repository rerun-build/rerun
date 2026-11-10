'use client'

import { updateMyLocaleAction } from '@/app/api/_actions/account.actions'
import type { LanguageChoice } from '@/components/account/LanguagePanel'
import { useSession } from '@/supabase/session/SessionProvider'
import { isStableLocale, PSEUDO_LOCALE } from '@rerun/i18n'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// The pseudo-locale lives in the cookie alone, so it is read back from the page's locale.
export function useLanguageChoice() {
    const t = useTranslations('account.language')
    const { user, refreshUser } = useSession()
    const locale = useLocale()
    const router = useRouter()
    const stored = user?.locale
    const value: LanguageChoice = locale === PSEUDO_LOCALE ? PSEUDO_LOCALE : isStableLocale(stored) ? stored : null

    const change = async (choice: LanguageChoice) => {
        const result = await updateMyLocaleAction({ locale: choice })
        if (!result.ok) {
            toast.error(t('failed'))
            return
        }
        // No success toast: it would speak the language being left, and the screen switching says it.
        await refreshUser()
        router.refresh()
    }

    return { value, change }
}
