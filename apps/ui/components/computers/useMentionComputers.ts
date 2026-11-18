'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { listMentionComputersAction } from '@/app/api/_actions/remote-computers.actions'
import type { MentionComputer } from '@/components/chat/MentionAutocomplete'
import { useRemoteComputersEnabled } from '@/components/layout/FeatureFlagsProvider'

const FRESH_MS = 10_000

// The computers `#` offers in a composer: read once, and again when `#` is typed after a while, so
// the state beside each one is the one the box gives now.
export function useMentionComputers(): { computers: MentionComputer[]; refresh: () => void } {
    const enabled = useRemoteComputersEnabled()
    const [computers, setComputers] = useState<MentionComputer[]>([])
    const readAt = useRef(0)

    const refresh = useCallback(() => {
        if (!enabled || Date.now() - readAt.current < FRESH_MS) return
        readAt.current = Date.now()
        void listMentionComputersAction().then(res => {
            if (res.ok) setComputers(res.computers.map(({ id, name, handle, os, status }) => ({ id, name, handle, os, status })))
        })
    }, [enabled])

    useEffect(refresh, [refresh])

    return { computers, refresh }
}
