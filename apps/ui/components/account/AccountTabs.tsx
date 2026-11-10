'use client'

import { DialogTabs } from '@/components/dialogs/DialogTabs'
import type { AccountTab } from '@/stores/account.store'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

const TAB_KEYS = { profile: 'profile', 'sign-in': 'signIn', language: 'language', delete: 'delete' } as const satisfies Record<AccountTab, string>

export function useAccountTabText(tab: AccountTab) {
    const t = useTranslations('account.tabs')
    return { label: t(`${TAB_KEYS[tab]}.label`), description: t(`${TAB_KEYS[tab]}.description`) }
}

// The language tab only shows once the language packs are out: before that every account reads English.
export function AccountTabs({ showLanguage, ...props }: { tab: AccountTab; onTabChange: (tab: AccountTab) => void; header: ReactNode; children: ReactNode; showLanguage: boolean }) {
    const t = useTranslations('account.tabs')
    const tabs = (['profile', 'sign-in', ...(showLanguage ? (['language'] as const) : []), 'delete'] as const satisfies readonly AccountTab[]).map(value => ({ value, label: t(`${TAB_KEYS[value]}.label`) }))
    return <DialogTabs tabs={tabs} {...props} />
}
