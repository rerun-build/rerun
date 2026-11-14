'use client'

import { detectInAppBrowser } from '@/lib/in-app-browser'
import { abandonTrigger, createLeaveWatcher, type SignupLeaveEvent } from '@/lib/auth/signup-abandon'
import { track } from '@rerun/analytics/client'
import type { SignupStep, SignupSurface } from '@rerun/analytics'
import { useCallback, useEffect, useRef } from 'react'

export function useSignupFunnel({ surface, active, initialStep }: { surface: SignupSurface; active: boolean; initialStep: SignupStep }) {
    const step = useRef(initialStep)
    const openedAt = useRef(0)
    const converted = useRef(false)
    const abandoned = useRef(false)

    useEffect(() => {
        if (!active) return
        step.current = initialStep
        openedAt.current = Date.now()
        converted.current = false
        abandoned.current = false
        track('signup_started', { surface, in_app_browser: detectInAppBrowser(navigator.userAgent) ?? undefined })
    }, [active, surface, initialStep])

    const leave = useCallback(
        (event: SignupLeaveEvent) => {
            if (converted.current || abandoned.current) return
            const trigger = abandonTrigger(event, step.current)
            if (!trigger) return
            abandoned.current = true
            track('signup_abandoned', { surface, last_step: step.current, trigger, seconds_spent: Math.round((Date.now() - openedAt.current) / 1000) }, { leavingPage: event !== 'dismissed' })
        },
        [surface]
    )

    useEffect(() => {
        if (!active) return
        const watcher = createLeaveWatcher(leave)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') watcher.hidden()
            else watcher.visible()
        }
        window.addEventListener('beforeunload', watcher.beforeUnload)
        document.addEventListener('visibilitychange', onVisibilityChange)
        window.addEventListener('pagehide', watcher.pageHide)
        return () => {
            window.removeEventListener('beforeunload', watcher.beforeUnload)
            document.removeEventListener('visibilitychange', onVisibilityChange)
            window.removeEventListener('pagehide', watcher.pageHide)
        }
    }, [active, leave])

    return {
        setStep: useCallback((next: SignupStep) => {
            step.current = next
        }, []),
        markConverted: useCallback(() => {
            converted.current = true
        }, []),
        dismiss: useCallback(() => leave('dismissed'), [leave]),
    }
}
