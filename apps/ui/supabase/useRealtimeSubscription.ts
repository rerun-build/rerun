'use client'

import type { Database, Tables } from '@/app/api/database.types'
import { createClient } from '@/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { randomUuid } from '@rerun/db/helpers'
import { useEffect, useRef } from 'react'

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

            channel.subscribe(subStatus => {
                if (!alive || disposed) return
                if (subStatus === 'SUBSCRIBED') {
                    attempt = 0
                    scheduleResync()
                } else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT' || subStatus === 'CLOSED') {
                    // Un même canal émet souvent plusieurs statuts d'échec (erreur de join puis
                    // phx_close) : chacun reprogrammait un connect(), les canaux doublaient à chaque
                    // cycle jusqu'à des milliers. Le premier statut retire le canal, les suivants sont ignorés.
                    alive = false
                    const delay = Math.min(1000 * 2 ** attempt, 15000)
                    attempt++
                    if (reconnectTimer) clearTimeout(reconnectTimer)
                    reconnectTimer = setTimeout(async () => {
                        reconnectTimer = null
                        if (disposed) return
                        // Attendre la fin du teardown avant de reconnecter, sinon le nouveau
                        // subscribe se fait no-op sur un socket en train de fermer.
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
