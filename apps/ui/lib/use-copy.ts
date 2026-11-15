'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const CONFIRMATION_MS = 1200

export function useCopy(): { copied: boolean; copy: (value: string) => void } {
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current)
    }, [])

    const copy = useCallback((value: string) => {
        navigator.clipboard
            .writeText(value)
            .then(() => {
                setCopied(true)
                if (timer.current) clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopied(false), CONFIRMATION_MS)
            })
            .catch(() => {})
    }, [])

    return { copied, copy }
}
