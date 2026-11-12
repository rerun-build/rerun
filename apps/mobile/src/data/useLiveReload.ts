import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect, useEffectEvent } from 'react'
import { AppState } from 'react-native'

import { supabase } from '@/auth/supabase'

const MAX_RETRY_MS = 15_000

/**
 * Keeps a screen's rows in step with the hub through Realtime, and reads them again whenever a
 * change may have gone by unheard: Postgres changes are never replayed, so a run started elsewhere
 * would otherwise stay missing until its row moves again, often at its very end.
 * - the app comes back to the foreground (iOS held it, the socket slept);
 * - the channel joins again after a drop (its first join is skipped: the screen reads on mount);
 * - the server closes the channel or it fails (expired token, timeout): a new one is opened, with
 *   a growing delay between attempts.
 *
 * `topic` names everything the channel filters on, so a new one opens when it changes; null opens
 * nothing yet. `listen` declares the `.on()` of each channel opened, bound to `changed`, which always
 * reaches the latest `reload`.
 */
export function useLiveReload(topic: string | null, listen: (channel: RealtimeChannel, changed: () => void) => void, reload: () => void) {
    const onListen = useEffectEvent(listen)
    const onChange = useEffectEvent(reload)

    useEffect(() => {
        const foreground = AppState.addEventListener('change', state => {
            if (state === 'active') onChange()
        })
        return () => foreground.remove()
    }, [])

    useEffect(() => {
        if (!topic) return
        let disposed = false
        let opened = 0
        let failures = 0
        let joinedOnce = false
        let retry: ReturnType<typeof setTimeout> | null = null
        let current: RealtimeChannel

        const open = (): RealtimeChannel => {
            let alive = true
            // supabase.channel() hands back the instance of a topic still taken, and leaving one is not instant.
            const channel = supabase.channel(`${topic}:${opened++}`)
            onListen(channel, () => onChange())
            channel.subscribe(status => {
                if (!alive || disposed) return
                if (status === 'SUBSCRIBED') {
                    failures = 0
                    if (joinedOnce) onChange()
                    joinedOnce = true
                    return
                }
                // One failure often reports twice (a join error, then the close): only the first one counts.
                alive = false
                const delay = Math.min(1000 * 2 ** failures++, MAX_RETRY_MS)
                retry = setTimeout(async () => {
                    retry = null
                    await supabase.removeChannel(channel)
                    if (!disposed) current = open()
                }, delay)
            })
            return channel
        }

        current = open()
        return () => {
            disposed = true
            if (retry) clearTimeout(retry)
            supabase.removeChannel(current)
        }
    }, [topic])
}
