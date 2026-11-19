'use client'

import { updateMyLocaleAction } from '@/app/api/_actions/account.actions'
import type { LanguageChoice } from '@/components/account/LanguagePanel'
import { useSession } from '@/supabase/session/SessionProvider'
import { isStableLocale, PSEUDO_LOCALE } from '@moldwright/i18n'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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
        await refreshUser()
        router.refresh()
    }

    return { value, change }
}
