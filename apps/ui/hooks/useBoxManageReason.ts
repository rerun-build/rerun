'use client'

import { useTranslations } from 'next-intl'

export function useBoxManageReason(): string {
    return useTranslations('errors')('boxManagerOnlyChange')
}
