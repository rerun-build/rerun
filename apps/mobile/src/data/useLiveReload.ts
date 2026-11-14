import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect, useEffectEvent } from 'react'
import { AppState } from 'react-native'

import { supabase } from '@/auth/supabase'

const MAX_RETRY_MS = 15_000

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
