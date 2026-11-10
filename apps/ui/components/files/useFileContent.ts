'use client'

import { filePreviewKind } from '@/lib/files/preview'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

type UseFileContentProps = {
    path: string
    name: string
    read: (path: string) => Promise<{ content: string; truncated: boolean }>
}

type ReadResult = { path: string; content: string | null; truncated: boolean; error: string | null }

// Only text files are read: every other kind is rendered straight from its raw URL.
export function useFileContent({ path, name, read }: UseFileContentProps) {
    const t = useTranslations('files.preview')
    const readFailedRef = useRef(t('readFailed'))
    readFailedRef.current = t('readFailed')
    const isText = filePreviewKind(name) === 'text'
    const [result, setResult] = useState<ReadResult | null>(null)

    useEffect(() => {
        if (!isText) return
        let cancelled = false
        void read(path)
            .then(({ content, truncated }) => {
                if (!cancelled) setResult({ path, content, truncated, error: null })
            })
            .catch(() => {
                if (!cancelled) setResult({ path, content: null, truncated: false, error: readFailedRef.current })
            })
        return () => {
            cancelled = true
        }
    }, [isText, path, read])

    const ready = result?.path === path ? result : null

    // What was just written, so the preview shows it without a round trip.
    const replaceContent = useCallback(
        (content: string) => setResult(current => (current?.path === path ? { ...current, content } : current)),
        [path],
    )

    return {
        content: ready?.content ?? null,
        truncated: ready?.truncated ?? false,
        error: ready?.error ?? null,
        loading: isText && !ready,
        replaceContent,
    }
}
