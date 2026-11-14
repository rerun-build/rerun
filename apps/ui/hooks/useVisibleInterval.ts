'use client'

import { useEffect } from 'react'

export function useVisibleInterval(callback: () => void | Promise<void>, ms: number) {
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined

        const run = () => {
            Promise.resolve(callback()).catch(() => {})
        }
        const start = () => {
            run()
            interval = setInterval(run, ms)
        }
        const stop = () => {
            clearInterval(interval)
            interval = undefined
        }
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') stop()
            else if (!interval) start()
        }

        if (document.visibilityState !== 'hidden') start()
        document.addEventListener('visibilitychange', onVisibility)

        return () => {
            stop()
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [callback, ms])
}
