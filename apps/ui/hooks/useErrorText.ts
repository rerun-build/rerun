'use client'

import type { ErrorCode, ErrorParams } from '@/lib/i18n/action-error'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

export type Refusal = { error?: string | null; code?: string; params?: ErrorParams }

export function useErrorText() {
    const t = useTranslations('errors')
    return useCallback(
        (failure: Refusal, fallback?: string): string => {
            const code = failure.code as ErrorCode | undefined
            if (code && t.has(code)) return t(code, failure.params as never)
            return failure.error || fallback || t('generic')
        },
        [t]
    )
}
