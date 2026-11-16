'use client'

import { onPageShownOrHidden, pageAttention } from '@/lib/desktop-shell/attention'
import { useBrainStore } from '@/stores/brain.store'
import { useEffect } from 'react'

const POLL_MS = 2 * 60 * 1000

// The engine cannot push to the browser, so the count of agent changes waiting for review is read
// on mount, every couple of minutes while the page is shown, and whenever it comes back.
export function useBrainProposalCount(enabled: boolean): number {
    const openProposals = useBrainStore(s => s.openProposals)
    const refresh = useBrainStore(s => s.refreshProposalCount)

    useEffect(() => {
        if (!enabled) return
        const tick = () => {
            if (pageAttention() !== 'hidden') refresh().catch(() => {})
        }
        tick()
        const timer = setInterval(tick, POLL_MS)
        const stopWatching = onPageShownOrHidden(tick)
        return () => {
            clearInterval(timer)
            stopWatching()
        }
    }, [enabled, refresh])

    return enabled ? openProposals : 0
}
