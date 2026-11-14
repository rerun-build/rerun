import { Directory, File, Paths } from 'expo-file-system'
import { useCallback, useSyncExternalStore } from 'react'

import { useAuth } from '@/auth/AuthProvider'

const folder = () => new Directory(Paths.document, 'pinned-coworkers')
const fileOf = (workspaceId: number) => new File(folder(), `${workspaceId}.json`)

const memory = new Map<number, string[]>()
const listeners = new Set<() => void>()
const NONE: string[] = []

function read(workspaceId: number): string[] {
    const known = memory.get(workspaceId)
    if (known) return known
    let ids: string[] = []
    try {
        const file = fileOf(workspaceId)
        if (file.exists) {
            const parsed: unknown = JSON.parse(file.textSync())
            if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === 'string')
        }
    } catch {}
    memory.set(workspaceId, ids)
    return ids
}

function write(workspaceId: number, ids: string[]) {
    memory.set(workspaceId, ids)
    try {
        folder().create({ intermediates: true, idempotent: true })
        fileOf(workspaceId).write(JSON.stringify(ids))
    } catch {}
    for (const listener of listeners) listener()
}

export function usePinnedAgents() {
    const { me } = useAuth()
    const workspaceId = me?.workspace.id
    const pinned = useSyncExternalStore(
        listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        () => (workspaceId === undefined ? NONE : read(workspaceId))
    )

    const pin = useCallback((id: string) => workspaceId !== undefined && write(workspaceId, [...read(workspaceId).filter(entry => entry !== id), id]), [workspaceId])
    const unpin = useCallback((id: string) => workspaceId !== undefined && write(workspaceId, read(workspaceId).filter(entry => entry !== id)), [workspaceId])
    const reorder = useCallback((ids: string[]) => workspaceId !== undefined && write(workspaceId, ids), [workspaceId])

    return { pinned, pin, unpin, reorder }
}
