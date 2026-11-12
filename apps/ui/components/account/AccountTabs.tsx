'use client'

import { DialogTabs } from '@/components/dialogs/DialogTabs'
import type { AccountTab } from '@/stores/account.store'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

const TAB_KEYS = { profile: 'profile', 'sign-in': 'signIn', language: 'language', desktop: 'desktop', delete: 'delete' } as const satisfies Record<AccountTab, string>

export function useAccountTabText(tab: AccountTab) {
    const t = useTranslations('account.tabs')
    return { label: t(`${TAB_KEYS[tab]}.label`), description: t(`${TAB_KEYS[tab]}.description`) }
}

// The language tab only shows once the language packs are out: before that every account reads English.
// The desktop tab only inside the desktop app.
export function AccountTabs({ showLanguage, showDesktop = false, ...props }: { tab: AccountTab; onTabChange: (tab: AccountTab) => void; header: ReactNode; children: ReactNode; showLanguage: boolean; showDesktop?: boolean }) {
    const t = useTranslations('account.tabs')
    const tabs = (['profile', 'sign-in', ...(showLanguage ? (['language'] as const) : []), ...(showDesktop ? (['desktop'] as const) : []), 'delete'] as const satisfies readonly AccountTab[]).map(value => ({ value, label: t(`${TAB_KEYS[value]}.label`) }))
    return <DialogTabs tabs={tabs} {...props} />
}
