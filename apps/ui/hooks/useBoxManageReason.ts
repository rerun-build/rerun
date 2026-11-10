'use client'

import { useTranslations } from 'next-intl'

// Why a control of a coworker is disabled for someone who only uses its Box.
export function useBoxManageReason(): string {
    return useTranslations('errors')('boxManagerOnlyChange')
}
