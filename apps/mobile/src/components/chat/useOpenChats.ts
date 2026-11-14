import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'

const MAX_OPEN_CHATS = 10

const storageKey = (agentId: string) => `rerun.open-chats.${agentId.replace(/[^\w.-]/g, '_')}`

function parseStored(raw: string | null): string[] {
    try {
        const value: unknown = raw ? JSON.parse(raw) : []
        return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    } catch {
        return []
    }
}

export function useOpenChats(agentId: string, sessionId: string | null): [string[], (id: string) => void] {
    const [openIds, setOpenIds] = useState<string[]>(() => (sessionId ? [sessionId] : []))
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        let cancelled = false
        SecureStore.getItemAsync(storageKey(agentId))
            .catch(() => null)
            .then(raw => {
                if (cancelled) return
                const stored = parseStored(raw)
                setOpenIds(current => [...stored, ...current.filter(id => !stored.includes(id))].slice(-MAX_OPEN_CHATS))
                setLoaded(true)
            })
        return () => {
            cancelled = true
        }
    }, [agentId])

    useEffect(() => {
        if (loaded) SecureStore.setItemAsync(storageKey(agentId), JSON.stringify(openIds)).catch(() => {})
    }, [loaded, agentId, openIds])

    const openChat = useCallback((id: string) => {
        setOpenIds(current => (current.includes(id) ? current : [...current, id].slice(-MAX_OPEN_CHATS)))
    }, [])

    return [openIds, openChat]
}
