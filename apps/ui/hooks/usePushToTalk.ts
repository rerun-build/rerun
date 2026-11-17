'use client'

import { useEffect, useRef } from 'react'

// A tap is not a hold: the microphone only opens once Space has stayed down this long, so a stray
// press on the board never lights the capture indicator, let alone the permission prompt.
const HOLD_MS = 200

type Options = {
    enabled: boolean
    /** Whether this Space going down is a hold to talk where the hook is used, and not Space meant for something else. */
    accepts: (event: KeyboardEvent) => boolean
    onStart: () => void
    onRelease: () => void
    /** The hold was lost rather than let go: the window lost the keyboard, or Escape. Nothing is sent. */
    onAbort: () => void
}

/** Hold Space to talk, wherever `accepts` says Space means it; let go to send. */
export function usePushToTalk({ enabled, accepts, onStart, onRelease, onAbort }: Options) {
    const handlers = useRef({ accepts, onStart, onRelease, onAbort })
    useEffect(() => {
        handlers.current = { accepts, onStart, onRelease, onAbort }
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
                // The repeats of the held key would scroll the page.
                if (event.code === 'Space') event.preventDefault()
                else if (event.key === 'Escape') settle('abort')
                return
            }
            if (!handlers.current.accepts(event)) return
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
