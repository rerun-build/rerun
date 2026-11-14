'use client'

import { useCallback, useEffect, useState } from 'react'
import { nanoid } from 'nanoid'
import { parseQueued, type QueuedMessage } from '@/lib/chat/queued-message'

function getStorageKey(uid: string) {
    return `composer-queued-${uid}`
}

function read(uid: string): QueuedMessage | null {
    try {
        return parseQueued(localStorage.getItem(getStorageKey(uid)))
    } catch {
        return null
    }
}

type QueueState = { queued: QueuedMessage | null; restoredId: string | null }

export function useQueuedMessage(uid: string) {
    const [{ queued, restoredId }, setState] = useState<QueueState>({ queued: null, restoredId: null })

    useEffect(() => {
        const found = read(uid)
        setState({ queued: found, restoredId: found?.id ?? null })
    }, [uid])

    useEffect(() => {
        const key = getStorageKey(uid)
        const onStorage = (event: StorageEvent) => {
            if (event.key !== null && event.key !== key) return
            setState(prev => ({ ...prev, queued: read(uid) }))
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [uid])

    const enqueue = useCallback(
        (text: string, behindRunId: string | null) => {
            const item: QueuedMessage = { id: nanoid(8), text, createdAt: Date.now(), behindRunId }
            try {
                localStorage.setItem(getStorageKey(uid), JSON.stringify(item))
            } catch {}
            setState(prev => ({ ...prev, queued: item }))
        },
        [uid]
    )

    const clear = useCallback(() => {
        try {
            localStorage.removeItem(getStorageKey(uid))
        } catch {}
        setState(prev => ({ ...prev, queued: null }))
    }, [uid])

    return { queued, restoredId, enqueue, clear }
}
