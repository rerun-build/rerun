'use client'

import { useEffect } from 'react'

import { usePageAttention } from '@/hooks/usePageAttention'

// A page nobody can see (a background tab, the desktop app hidden in the tray or minimized) has nobody
// reading the result, so polling stops there and catches up the moment it is shown again. A window
// merely behind another app is still on screen: it keeps polling. A poll that fails, the network not
// back yet, is retried at the next tick.
export function useVisibleInterval(callback: () => void | Promise<void>, ms: number) {
    const hidden = usePageAttention() === 'hidden'

    useEffect(() => {
        if (hidden) return
        const run = () => {
            Promise.resolve(callback()).catch(() => {})
        }
        run()
        const interval = setInterval(run, ms)
        return () => clearInterval(interval)
    }, [callback, ms, hidden])
}
