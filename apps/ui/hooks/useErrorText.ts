'use client'

import type { ErrorCode, ErrorParams } from '@/lib/i18n/action-error'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

// Only a key this bundle's `errors` catalog knows is translated: a code it has never heard of, from a
// server deployed ahead of the page, falls back to the server's English.
export type Refusal = { error?: string | null; code?: string; params?: ErrorParams }

// Thrown where a refusal cannot be returned (a store method, a fetch helper), so the screen that
// catches it still translates its code.
export class RefusalError extends Error {
    constructor(readonly refusal: Refusal) {
        super(refusal.error ?? '')
    }
}

// What a refused action says on screen: its code in the reader's language, or the server's English
// text for a refusal that has no code yet. `fallback` stands in when the refusal carries no text.
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

// The same for a caught error: a thrown refusal is translated, any other error keeps its message.
export function useThrownText() {
    const errorText = useErrorText()
    return useCallback(
        (err: unknown, fallback: string): string => {
            if (err instanceof RefusalError) return errorText(err.refusal, fallback)
            return err instanceof Error && err.message ? err.message : fallback
        },
        [errorText]
    )
}
