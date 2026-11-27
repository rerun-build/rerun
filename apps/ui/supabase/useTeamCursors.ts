'use client'

import { useMemberDirectory } from '@/hooks/useMemberProfiles'
import { type CursorPayload, cursorFromPayload, leavingUserId, placeCursor, type TeamCursor, type TimedCursor } from '@/lib/board/team-cursor'
import { createChannelRecovery } from '@/supabase/channel-recovery'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { REALTIME_CHANNEL_STATES, type RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'

export type { TeamCursor } from '@/lib/board/team-cursor'

const STALE_MS = 5000
const THROTTLE_MS = 100

export function useTeamCursors(workspaceId: number | undefined) {
    const { session, organizationStaff } = useSession()
    const userId = session?.user?.id
    // Until this tab knows its user is a member, it watches and shows nobody: the team of the
    // organization that runs the workspace is never seen on it. The policies of the channel refuse
    // what they would send anyway.
    const visible = organizationStaff === false
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
    const visibleRef = useRef(visible)
    useEffect(() => {
        visibleRef.current = visible
        const channel = channelRef.current
        if (visible && userId && channel?.state === REALTIME_CHANNEL_STATES.joined) void channel.track({ userId })
    }, [visible, userId])

    const flush = useCallback(() => setCursors(Array.from(cursorsRef.current.values())), [])

    useEffect(() => {
        if (!channelKey || !userId) return

        const supabase = createClient()
        const cursorsMap = cursorsRef.current
        let disposed = false
        let channel: RealtimeChannel | null = null
        // Un canal fermé par le serveur (token expiré, onglet réveillé) n'est jamais rejoint par
        // realtime-js : sans remplacement, les curseurs restent morts jusqu'au reload.
        const recovery = createChannelRecovery(() => {
            if (!disposed) void setup()
        })

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

            recovery.watch(created)
            created.subscribe(status => {
                if (disposed) return
                if (status === 'SUBSCRIBED' && visibleRef.current) created.track({ userId })
                recovery.onStatus(created, status)
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
            recovery.dispose()
            clearInterval(prune)
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
            // 10 requêtes par seconde pendant un pan. Un curseur perdu n'a aucune importance.
            if (!visible || !channel || channel.state !== REALTIME_CHANNEL_STATES.joined || !userId) return

            if (!world) {
                channel.send({ type: 'broadcast', event: 'cursor-leave', payload: { userId } })
                return
            }

            const now = performance.now()
            if (now - lastSentRef.current < THROTTLE_MS) return
            lastSentRef.current = now
            channel.send({ type: 'broadcast', event: 'cursor', payload: { userId, x: world.x, y: world.y } satisfies CursorPayload })
        },
        [userId, visible]
    )

    return { cursors, onPointerWorldMove }
}
