'use client'

import { useMemberDirectory } from '@/hooks/useMemberProfiles'
import { type CursorPayload, cursorFromPayload, leavingUserId, placeCursor, type TeamCursor, type TimedCursor } from '@/lib/board/team-cursor'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { REALTIME_CHANNEL_STATES, type RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'

export type { TeamCursor } from '@/lib/board/team-cursor'

const STALE_MS = 5000
const THROTTLE_MS = 50

export function useTeamCursors(workspaceId: number | undefined) {
    const { session } = useSession()
    const userId = session?.user?.id
    const channelKey = workspaceId === undefined ? undefined : `cursors:${workspaceId}`

    const memberOf = useMemberDirectory(workspaceId)
    const memberOfRef = useRef(memberOf)
    useEffect(() => {
        memberOfRef.current = memberOf
    })

    const [cursors, setCursors] = useState<TeamCursor[]>([])
    const cursorsRef = useRef<Map<string, TimedCursor>>(new Map())
    const channelRef = useRef<RealtimeChannel | null>(null)
    const lastSentRef = useRef(0)

    const flush = useCallback(() => setCursors(Array.from(cursorsRef.current.values())), [])

    useEffect(() => {
        if (!channelKey || !userId) return

        const supabase = createClient()
        const cursorsMap = cursorsRef.current
        let disposed = false
        let channel: RealtimeChannel | null = null
        let attempt = 0
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null

        // Le topic est une room broadcast partagée, donc il ne peut pas être rendu unique. Le
        // client browser étant un singleton, un remontage rapide peut retomber sur le canal
        // précédent encore joint (removeChannel est asynchrone) et ses `.on()` throwent : on
        // attend la fin du teardown du canal homonyme avant d'en créer un neuf.
        const setup = async () => {
            const stale = supabase.getChannels().find(c => c.topic === `realtime:${channelKey}`)
            if (stale) await supabase.removeChannel(stale)
            if (disposed) return

            // Private: Realtime checks the policies on `realtime.messages` with the user's JWT, so
            // only a member of the workspace joins or sends on it.
            const created = supabase.channel(channelKey, {
                config: { private: true, broadcast: { self: false }, presence: { key: userId } },
            })
            channel = created
            channelRef.current = created

            created.on('broadcast', { event: 'cursor' }, ({ payload }) => {
                const cursor = cursorFromPayload(payload, memberOfRef.current)
                if (!cursor || cursor.userId === userId) return
                if (placeCursor(cursorsMap, cursor, performance.now())) flush()
            })

            const drop = (id: string | null | undefined) => {
                if (id && cursorsMap.delete(id)) flush()
            }
            created.on('broadcast', { event: 'cursor-leave' }, ({ payload }) => drop(leavingUserId(payload)))
            created.on('presence', { event: 'leave' }, ({ key }) => drop(key))

            let alive = true
            // Un canal fermé par le serveur (token expiré, onglet réveillé) n'est jamais rejoint par
            // realtime-js : sans reconnexion, les curseurs restent morts jusqu'au reload.
            created.subscribe(status => {
                if (!alive || disposed) return
                if (status === 'SUBSCRIBED') {
                    attempt = 0
                    created.track({ userId })
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    alive = false
                    const delay = Math.min(1000 * 2 ** attempt, 15000)
                    attempt++
                    if (reconnectTimer) clearTimeout(reconnectTimer)
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null
                        if (!disposed) void setup()
                    }, delay)
                }
            })
        }
        void setup()

        const prune = setInterval(() => {
            const now = performance.now()
            let changed = false
            for (const [id, c] of cursorsMap) {
                if (now - c.ts > STALE_MS) {
                    cursorsMap.delete(id)
                    changed = true
                }
            }
            if (changed) flush()
        }, 1000)

        return () => {
            disposed = true
            clearInterval(prune)
            if (reconnectTimer) clearTimeout(reconnectTimer)
            cursorsMap.clear()
            setCursors([])
            channelRef.current = null
            if (channel) supabase.removeChannel(channel)
        }
    }, [channelKey, userId, flush])

    const onPointerWorldMove = useCallback(
        (world: { x: number; y: number } | null) => {
            const channel = channelRef.current
            // Hors d'un canal joint, realtime-js retombe sur un POST HTTP à chaque appel, soit jusqu'à
            // 20 requêtes par seconde pendant un pan. Un curseur perdu n'a aucune importance.
            if (!channel || channel.state !== REALTIME_CHANNEL_STATES.joined || !userId) return

            if (!world) {
                channel.send({ type: 'broadcast', event: 'cursor-leave', payload: { userId } })
                return
            }

            const now = performance.now()
            if (now - lastSentRef.current < THROTTLE_MS) return
            lastSentRef.current = now
            channel.send({ type: 'broadcast', event: 'cursor', payload: { userId, x: world.x, y: world.y } satisfies CursorPayload })
        },
        [userId]
    )

    return { cursors, onPointerWorldMove }
}
