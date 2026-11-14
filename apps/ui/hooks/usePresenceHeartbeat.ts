'use client'

import { PRESENCE_HEARTBEAT_MS, shouldBeat } from '@/lib/notifications/presence'
import { useEffect, useRef } from 'react'

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function usePresenceHeartbeat(enabled: boolean) {
    const lastInteraction = useRef(0)

    useEffect(() => {
        if (!enabled) return

        const bump = () => {
            lastInteraction.current = Date.now()
        }
        const send = (method: 'POST' | 'DELETE', keepalive = false) => {
            void fetch('/api/presence', { method, keepalive }).catch(() => {})
        }
        const beat = () => {
            if (shouldBeat({ visible: document.visibilityState === 'visible', lastInteractionAt: lastInteraction.current, now: Date.now() })) send('POST')
        }
        const onVisibility = () => {
            if (document.visibilityState !== 'visible') return send('DELETE', true)
            bump()
            beat()
        }
        const onPageHide = () => send('DELETE', true)

        bump()
        beat()
        const interval = setInterval(beat, PRESENCE_HEARTBEAT_MS)
        INTERACTION_EVENTS.forEach(event => window.addEventListener(event, bump, { passive: true }))
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('pagehide', onPageHide)

        return () => {
            clearInterval(interval)
            INTERACTION_EVENTS.forEach(event => window.removeEventListener(event, bump))
            document.removeEventListener('visibilitychange', onVisibility)
            window.removeEventListener('pagehide', onPageHide)
        }
    }, [enabled])
}
