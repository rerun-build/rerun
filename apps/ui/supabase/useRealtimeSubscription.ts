'use client'

import type { Database, Tables } from '@/app/api/database.types'
import { createClient } from '@/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect, useRef } from 'react'
import { randomUuid } from '@/lib/random-uuid'

type TableName = keyof Database['public']['Tables']

type EventCallbacks<T extends TableName> = {
    onInsert?: (payload: Tables<T>) => void
    onUpdate?: (payload: Tables<T>, oldRecord: Tables<T>) => void
    onDelete?: (payload: Tables<T>) => void
}

type FilterConfig = {
    column: string
    value: string | number
}

type UseRealtimeSubscriptionOptions<T extends TableName> = EventCallbacks<T> & {
    filter?: FilterConfig
    enabled?: boolean
    channelId: string
    onResync?: () => void
}

export function useRealtimeSubscription<T extends TableName>(table: T, options: UseRealtimeSubscriptionOptions<T>) {
    const { filter, onInsert, onUpdate, onDelete, onResync, enabled = true, channelId } = options

    const callbacksRef = useRef({ onInsert, onUpdate, onDelete, onResync })
    callbacksRef.current = { onInsert, onUpdate, onDelete, onResync }

    useEffect(() => {
        if (!enabled) return

        const supabase = createClient()

        const filterString = filter ? `${filter.column}=eq.${filter.value}` : undefined

        let disposed = false
        let attempt = 0
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null
        let resyncTimer: ReturnType<typeof setTimeout> | null = null
        let current: RealtimeChannel | null = null

        const scheduleResync = () => {
            if (!callbacksRef.current.onResync) return
            if (resyncTimer) clearTimeout(resyncTimer)
            resyncTimer = setTimeout(() => callbacksRef.current.onResync?.(), 200)
        }

        const connect = (): RealtimeChannel => {
            let alive = true
            const channel = supabase.channel(`${channelId}:${randomUuid()}`)

            if (callbacksRef.current.onInsert) {
                channel.on<Tables<T>>(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table,
                        filter: filterString,
                    },
                    payload => {
                        callbacksRef.current.onInsert?.(payload.new as Tables<T>)
                    }
                )
            }

            if (callbacksRef.current.onUpdate) {
                channel.on<Tables<T>>(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table,
                        filter: filterString,
                    },
                    payload => {
                        callbacksRef.current.onUpdate?.(payload.new as Tables<T>, payload.old as Tables<T>)
                    }
                )
            }

            if (callbacksRef.current.onDelete) {
                channel.on<Tables<T>>(
                    'postgres_changes',
                    {
                        event: 'DELETE',
                        schema: 'public',
                        table,
                    },
                    payload => {
                        const oldRecord = payload.old as Tables<T>
                        callbacksRef.current.onDelete?.(oldRecord)
                    }
                )
            }

            channel.subscribe(subStatus => {
                if (!alive || disposed) return
                if (subStatus === 'SUBSCRIBED') {
                    attempt = 0
                    scheduleResync()
                } else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT' || subStatus === 'CLOSED') {
                    alive = false
                    const delay = Math.min(1000 * 2 ** attempt, 15000)
                    attempt++
                    if (reconnectTimer) clearTimeout(reconnectTimer)
                    reconnectTimer = setTimeout(async () => {
                        reconnectTimer = null
                        if (disposed) return
                        await supabase.removeChannel(channel)
                        if (disposed) return
                        current = connect()
                    }, delay)
                }
            })

            return channel
        }

        current = connect()

        const onVisible = () => {
            if (document.visibilityState === 'visible') scheduleResync()
        }
        const onOnline = () => scheduleResync()
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('online', onOnline)

        return () => {
            disposed = true
            if (reconnectTimer) clearTimeout(reconnectTimer)
            if (resyncTimer) clearTimeout(resyncTimer)
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('online', onOnline)
            if (current) supabase.removeChannel(current)
        }
    }, [table, filter?.column, filter?.value, enabled, channelId])
}
