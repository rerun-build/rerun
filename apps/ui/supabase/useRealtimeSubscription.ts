'use client'

import type { Database, Tables } from '@/app/api/database.types'
import { createChannelRecovery } from '@/supabase/channel-recovery'
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
    /** Filtre optionnel pour écouter uniquement les changements d'un enregistrement spécifique */
    filter?: FilterConfig
    /** Activer/désactiver la subscription (default: true) */
    enabled?: boolean
    /** Identifiant unique pour éviter les conflits de channels entre composants */
    channelId: string
    /**
     * Appelé après un (re)subscribe, au retour de l'onglet au premier plan, ou au retour réseau.
     * Le consommateur re-fetch les lignes autoritatives et réconcilie les événements manqués
     * pendant que le socket était coupé (le hook reste générique, il ne sait pas quoi refetch).
     */
    onResync?: () => void
}

/**
 * Hook générique pour écouter les changements en temps réel sur une table Supabase
 *
 * @example
 * // Écouter tous les dialogs d'un projet
 * useRealtimeSubscription("dialogs", {
 *   filter: { column: "project_id", value: projectId },
 *   onInsert: (dialog) => console.log("New dialog:", dialog),
 *   onUpdate: (dialog, old) => console.log("Updated:", old, "->", dialog),
 *   onDelete: (dialog) => console.log("Deleted:", dialog),
 * })
 *
 * @example
 * // Écouter un speaker spécifique
 * useRealtimeSubscription("speakers", {
 *   filter: { column: "id", value: speakerId },
 *   onUpdate: (speaker) => setSpeaker(speaker),
 * })
 */
export function useRealtimeSubscription<T extends TableName>(table: T, options: UseRealtimeSubscriptionOptions<T>) {
    const { filter, onInsert, onUpdate, onDelete, onResync, enabled = true, channelId } = options

    // Refs pour éviter les re-subscriptions inutiles quand les callbacks changent
    const callbacksRef = useRef({ onInsert, onUpdate, onDelete, onResync })
    callbacksRef.current = { onInsert, onUpdate, onDelete, onResync }

    useEffect(() => {
        if (!enabled) return

        const supabase = createClient()

        const filterString = filter ? `${filter.column}=eq.${filter.value}` : undefined

        let disposed = false
        let resyncTimer: ReturnType<typeof setTimeout> | null = null
        let current: RealtimeChannel | null = null
        const recovery = createChannelRecovery(async () => {
            const replaced = current
            if (replaced) await supabase.removeChannel(replaced)
            if (!disposed) current = connect()
        })

        const scheduleResync = () => {
            if (!callbacksRef.current.onResync) return
            if (resyncTimer) clearTimeout(resyncTimer)
            resyncTimer = setTimeout(() => callbacksRef.current.onResync?.(), 200)
        }

        const connect = (): RealtimeChannel => {
            // Topic unique par connexion : le client browser est un singleton et `channel(topic)`
            // rend le canal EXISTANT sur collision — un canal encore joint dont les `.on()`
            // throwent ("cannot add callbacks after subscribe"). Le filtrage postgres_changes est
            // server-side, le nom du topic n'y joue aucun rôle.
            const channel = supabase.channel(`${channelId}:${randomUuid()}`)

            // INSERT et UPDATE supportent les filtres
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

            // DELETE ne supporte PAS les filtres - on filtre manuellement côté client
            if (callbacksRef.current.onDelete) {
                channel.on<Tables<T>>(
                    'postgres_changes',
                    {
                        event: 'DELETE',
                        schema: 'public',
                        table,
                        // Pas de filter ici !
                    },
                    payload => {
                        const oldRecord = payload.old as Tables<T>
                        callbacksRef.current.onDelete?.(oldRecord)
                    }
                )
            }

            recovery.watch(channel)
            channel.subscribe(subStatus => {
                if (disposed) return
                if (subStatus === 'SUBSCRIBED') scheduleResync()
                recovery.onStatus(channel, subStatus)
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
            recovery.dispose()
            if (resyncTimer) clearTimeout(resyncTimer)
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('online', onOnline)
            if (current) supabase.removeChannel(current)
        }
    }, [table, filter?.column, filter?.value, enabled, channelId])
}
