'use client'

import { onPageShownOrHidden, pageAttention } from '@/lib/desktop-shell/attention'
import { PRESENCE_HEARTBEAT_MS, shouldBeat } from '@/lib/notifications/presence'
import { useEffect, useRef } from 'react'

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

// Tells the hub this tab is in the foreground, which is what lets the notification fan-out skip the
// email for someone who is already getting the toast. The desktop app hidden in the tray or minimized
// counts as gone, although its `document.visibilityState` stays visible.
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
            if (shouldBeat({ visible: pageAttention() !== 'hidden', lastInteractionAt: lastInteraction.current, now: Date.now() })) send('POST')
        }
        const onShownOrHidden = (shown: boolean) => {
            if (!shown) return send('DELETE', true)
            bump()
            beat()
        }
        const onPageHide = () => send('DELETE', true)

        bump()
        beat()
        const interval = setInterval(beat, PRESENCE_HEARTBEAT_MS)
        INTERACTION_EVENTS.forEach(event => window.addEventListener(event, bump, { passive: true }))
        const stopWatching = onPageShownOrHidden(onShownOrHidden)
        window.addEventListener('pagehide', onPageHide)

        return () => {
            clearInterval(interval)
            INTERACTION_EVENTS.forEach(event => window.removeEventListener(event, bump))
            stopWatching()
            window.removeEventListener('pagehide', onPageHide)
        }
    }, [enabled])
}
