'use client'

import { useEffect, useRef } from 'react'

import { shouldPushToTalk } from '@/lib/foreman/push-to-talk'

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

const HOLD_MS = 200

type Options = {
    enabled: boolean
    onStart: () => void
    onRelease: () => void
    onAbort: () => void
}

export function usePushToTalk({ enabled, onStart, onRelease, onAbort }: Options) {
    const handlers = useRef({ onStart, onRelease, onAbort })
    useEffect(() => {
        handlers.current = { onStart, onRelease, onAbort }
    })

    useEffect(() => {
        if (!enabled) return
        let timer: ReturnType<typeof setTimeout> | null = null
        let held = false
        let started = false

        const settle = (end: 'release' | 'abort') => {
            if (timer) clearTimeout(timer)
            timer = null
            const wasStarted = started
            held = false
            started = false
            if (!wasStarted) return
            if (end === 'release') handlers.current.onRelease()
            else handlers.current.onAbort()
        }

        const down = (event: KeyboardEvent) => {
            if (held) {
                if (event.code === 'Space') event.preventDefault()
                else if (event.key === 'Escape') settle('abort')
                return
            }
            const focused = document.activeElement
            const focusHeld = focused !== null && focused !== document.body && focused !== document.documentElement
            if (!shouldPushToTalk(event, { focusHeld, overlayOpen: document.querySelector(OVERLAYS) !== null })) return
            event.preventDefault()
            held = true
            timer = setTimeout(() => {
                timer = null
                started = true
                handlers.current.onStart()
            }, HOLD_MS)
        }
        const up = (event: KeyboardEvent) => {
            if (held && event.code === 'Space') settle('release')
        }
        const lose = () => {
            if (held) settle('abort')
        }
        const hide = () => {
            if (document.hidden) lose()
        }

        window.addEventListener('keydown', down)
        window.addEventListener('keyup', up)
        window.addEventListener('blur', lose)
        document.addEventListener('visibilitychange', hide)
        return () => {
            window.removeEventListener('keydown', down)
            window.removeEventListener('keyup', up)
            window.removeEventListener('blur', lose)
            document.removeEventListener('visibilitychange', hide)
            lose()
        }
    }, [enabled])
}
