'use client'

import { listMemberProfilesAction } from '@/app/api/_actions/members.actions'
import { FORMER_MEMBER, type AuthorProfile } from '@/lib/chat/message-author'
import { useCallback, useEffect, useRef, useState } from 'react'

type Directory = Map<string, AuthorProfile>

export const UNNAMED = 'Teammate'
const REFRESH_AFTER_MS = 60_000

const cache = new Map<number, { directory: Directory; readAt: number }>()
const inFlight = new Map<number, Promise<Directory>>()

function readDirectory(workspaceId: number): Promise<Directory> {
    const pending = inFlight.get(workspaceId)
    if (pending) return pending
    const read = listMemberProfilesAction()
        .then(members => {
            const directory: Directory = new Map(members.map(member => [member.id, { id: member.id, name: member.name ?? UNNAMED, photo: member.avatarUrl ?? undefined }]))
            cache.set(workspaceId, { directory, readAt: Date.now() })
            return directory
        })
        .catch(() => cache.get(workspaceId)?.directory ?? new Map())
        .finally(() => inFlight.delete(workspaceId))
    inFlight.set(workspaceId, read)
    return read
}

function directoryFor(workspaceId: number, authorIds: string[]): Promise<Directory> {
    const cached = cache.get(workspaceId)
    if (!cached) return readDirectory(workspaceId)
    const complete = authorIds.every(id => cached.directory.has(id))
    return complete || Date.now() - cached.readAt < REFRESH_AFTER_MS ? Promise.resolve(cached.directory) : readDirectory(workspaceId)
}

export function useMemberProfiles(workspaceId: number | undefined, authorIds: readonly string[]): (authorId: string) => AuthorProfile | null {
    const [directory, setDirectory] = useState<Directory | null>(() => (workspaceId === undefined ? null : (cache.get(workspaceId)?.directory ?? null)))
    const wanted = authorIds.join(',')

    useEffect(() => {
        if (workspaceId === undefined || !wanted) return
        let active = true
        void directoryFor(workspaceId, wanted.split(',')).then(next => {
            if (active) setDirectory(next)
        })
        return () => {
            active = false
        }
    }, [workspaceId, wanted])

    return useCallback((authorId: string) => (directory ? (directory.get(authorId) ?? FORMER_MEMBER) : null), [directory])
}

export function useMemberDirectory(workspaceId: number | undefined): (userId: string) => AuthorProfile | null {
    const [directory, setDirectory] = useState<Directory | null>(() => (workspaceId === undefined ? null : (cache.get(workspaceId)?.directory ?? null)))
    const currentWorkspaceRef = useRef(workspaceId)

    useEffect(() => {
        currentWorkspaceRef.current = workspaceId
        if (workspaceId === undefined) return
        void directoryFor(workspaceId, []).then(next => {
            if (currentWorkspaceRef.current === workspaceId) setDirectory(next)
        })
    }, [workspaceId])

    return useCallback(
        (userId: string) => {
            const known = directory?.get(userId)
            if (known || workspaceId === undefined) return known ?? null
            void directoryFor(workspaceId, [userId]).then(next => {
                if (currentWorkspaceRef.current === workspaceId) setDirectory(next)
            })
            return null
        },
        [directory, workspaceId]
    )
}
