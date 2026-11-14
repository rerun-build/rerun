'use client'

import { useCallback, useEffect, useRef } from 'react'

export function usePopupClosePoll(onClosed: () => void): (popup: Window | null) => void {
    const onClosedRef = useRef(onClosed)
    onClosedRef.current = onClosed
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const clear = () => {
        if (intervalRef.current !== null) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
        }
    }

    useEffect(() => clear, [])

    return useCallback(popup => {
        clear()
        if (!popup) {
            onClosedRef.current()
            return
        }
        intervalRef.current = setInterval(() => {
            if (popup.closed) {
                clear()
                onClosedRef.current()
            }
        }, 500)
    }, [])
}
