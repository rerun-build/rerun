'use client'

import { useLastInteraction } from '@/hooks/useLastInteraction'
import { onPageShownOrHidden, pageAttention } from '@/lib/desktop-shell/attention'
import { PRESENCE_HEARTBEAT_MS, shouldBeat } from '@/lib/notifications/presence'
import { useEffect } from 'react'

// Tells the hub this tab is in the foreground, which is what lets the notification fan-out skip the
// email for someone who is already getting the toast. The desktop app hidden in the tray or minimized
// counts as gone, although its `document.visibilityState` stays visible.
export function usePresenceHeartbeat(enabled: boolean) {
    const { lastInteractionRef, touch } = useLastInteraction(enabled)

    useEffect(() => {
        if (!enabled) return

        const send = (method: 'POST' | 'DELETE', keepalive = false) => {
            void fetch('/api/presence', { method, keepalive }).catch(() => {})
        }
        const beat = () => {
            if (shouldBeat({ visible: pageAttention() !== 'hidden', lastInteractionAt: lastInteractionRef.current, now: Date.now() })) send('POST')
        }
        const onShownOrHidden = (shown: boolean) => {
            if (!shown) return send('DELETE', true)
            touch()
            beat()
        }
        const onPageHide = () => send('DELETE', true)

        touch()
        beat()
        const interval = setInterval(beat, PRESENCE_HEARTBEAT_MS)
        const stopWatching = onPageShownOrHidden(onShownOrHidden)
        window.addEventListener('pagehide', onPageHide)

        return () => {
            clearInterval(interval)
            stopWatching()
            window.removeEventListener('pagehide', onPageHide)
        }
    }, [enabled, lastInteractionRef, touch])
}
