import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_OPEN_CHATS = 10

const storageKey = (agentId: string) => `rerun.open-chats.${agentId.replace(/[^\w.-]/g, '_')}`

function readStored(agentId: string): string[] {
    try {
        return parseStored(SecureStore.getItem(storageKey(agentId)))
    } catch {
        return []
    }
}

function parseStored(raw: string | null): string[] {
    try {
        const value: unknown = raw ? JSON.parse(raw) : []
        return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    } catch {
        return []
    }
}

// The conversations left open on a coworker, kept on the device from one visit to the next, as the
// web keeps its tabs. Read before the first frame: the row of pages opens as it stays.
export function useOpenChats(agentId: string, sessionId: string | null): [string[], (id: string) => void] {
    const [stored] = useState(() => readStored(agentId))
    const [openIds, setOpenIds] = useState<string[]>(() => (sessionId && !stored.includes(sessionId) ? [...stored, sessionId] : stored).slice(-MAX_OPEN_CHATS))
    const written = useRef(JSON.stringify(stored))

    useEffect(() => {
        const value = JSON.stringify(openIds)
        if (value === written.current) return
        written.current = value
        SecureStore.setItemAsync(storageKey(agentId), value).catch(() => {})
    }, [agentId, openIds])

    const openChat = useCallback((id: string) => {
        setOpenIds(current => (current.includes(id) ? current : [...current, id].slice(-MAX_OPEN_CHATS)))
    }, [])

    return [openIds, openChat]
}
