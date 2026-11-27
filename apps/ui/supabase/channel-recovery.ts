'use client'

import { REALTIME_CHANNEL_STATES, REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js'

const REJOIN_GRACE_MS = 30_000
const MAX_REPLACE_DELAY_MS = 15_000

type Waiting = 'replace' | 'check' | null

// realtime-js rejoins a channel that errored or timed out by itself once the socket is back, and does not
// reconnect a hidden page. Replacing every such channel on top of that doubled the joins of each drop
// on one socket until Realtime refused them ("Too many joins on this socket") and the cycle began
// again, and its `subscribe()` reopened sockets in background tabs. So a channel is replaced only when
// Realtime will not bring it back: closed by the server, or still not joined a while after an error.
// A hidden page waits until it is shown, like realtime-js. The desktop app keeps its window visible to
// the document, so its channels go on recovering in the tray.
export function createChannelRecovery(replace: () => void) {
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let waiting: Waiting = null
    let watched: RealtimeChannel | null = null

    const clear = () => {
        if (timer) clearTimeout(timer)
        timer = null
    }
    const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

    const replaceSoon = () => {
        clear()
        if (pageHidden()) {
            waiting = 'replace'
            return
        }
        const delay = Math.min(1000 * 2 ** attempt, MAX_REPLACE_DELAY_MS)
        attempt++
        timer = setTimeout(() => {
            timer = null
            // Removing the old channel closes it: that CLOSED must not ask for one more replacement.
            watched = null
            replace()
        }, delay)
    }

    const checkLater = (channel: RealtimeChannel) => {
        clear()
        timer = setTimeout(() => {
            timer = null
            if (channel !== watched || channel.state === REALTIME_CHANNEL_STATES.joined) return
            if (pageHidden()) waiting = 'check'
            else replaceSoon()
        }, REJOIN_GRACE_MS)
    }

    const onVisibilityChange = () => {
        if (pageHidden() || !waiting || !watched) return
        const next = waiting
        waiting = null
        // A channel that only errored is rejoined by realtime-js as the page comes back: give it the
        // same grace before replacing it.
        if (next === 'replace') replaceSoon()
        else checkLater(watched)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return {
        // The channel whose statuses count from now on; those of a replaced one are ignored.
        watch(channel: RealtimeChannel) {
            watched = channel
        },
        onStatus(channel: RealtimeChannel, status: `${REALTIME_SUBSCRIBE_STATES}`) {
            if (channel !== watched) return
            if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                attempt = 0
                waiting = null
                clear()
            } else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
                replaceSoon()
            } else {
                checkLater(channel)
            }
        },
        dispose() {
            clear()
            watched = null
            document.removeEventListener('visibilitychange', onVisibilityChange)
        },
    }
}
