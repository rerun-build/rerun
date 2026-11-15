import { FORMER_MEMBER, type AuthorProfile, type MemberProfile } from '@rerun/contracts'
import { useCallback, useEffect, useState } from 'react'

import { fetchMemberProfiles } from '@/api/members'
import { useAuth } from '@/auth/AuthProvider'
import { cachedMembers } from '@/data/local-cache'
import { translatorFor } from '@/i18n/translator'

type Directory = Map<string, AuthorProfile>

const REFRESH_AFTER_MS = 60_000

const inFlight = new Map<number, Promise<Directory | null>>()
const readThisLaunch = new Set<number>()

export function forgetMemberReads() {
    readThisLaunch.clear()
}

type Caller = { accessToken: string; workspaceId: number }

const directoryOf = (members: MemberProfile[]): Directory => {
    const unnamed = translatorFor('mobileHome')('teammate')
    return new Map(members.map(member => [member.id, { id: member.id, name: member.name ?? unnamed, photo: member.avatarUrl ?? undefined }]))
}

function keptDirectory(workspaceId: number): { directory: Directory; readAt: number } | null {
    const kept = cachedMembers(workspaceId).read()
    return kept ? { directory: directoryOf(kept.members), readAt: kept.readAt } : null
}

function readDirectory(caller: Caller): Promise<Directory | null> {
    const pending = inFlight.get(caller.workspaceId)
    if (pending) return pending
    const read = cachedMembers(caller.workspaceId)
        .load(async () => ({ members: await fetchMemberProfiles(caller), readAt: Date.now() }))
        .then(({ members }) => {
            readThisLaunch.add(caller.workspaceId)
            return directoryOf(members)
        })
        .catch(() => keptDirectory(caller.workspaceId)?.directory ?? null)
        .finally(() => inFlight.delete(caller.workspaceId))
    inFlight.set(caller.workspaceId, read)
    return read
}

function directoryFor(caller: Caller, authorIds: string[]): Promise<Directory | null> {
    const cached = keptDirectory(caller.workspaceId)
    if (!cached || !readThisLaunch.has(caller.workspaceId)) return readDirectory(caller)
    const complete = authorIds.every(id => cached.directory.has(id))
    return complete || Date.now() - cached.readAt < REFRESH_AFTER_MS ? Promise.resolve(cached.directory) : readDirectory(caller)
}

export function useMemberProfiles(authorIds: readonly string[]): (authorId: string) => AuthorProfile | null | undefined {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [directory, setDirectory] = useState<Directory | 'unavailable' | null>(() => (workspaceId === undefined ? null : (keptDirectory(workspaceId)?.directory ?? null)))
    const wanted = authorIds.join(',')

    useEffect(() => {
        if (!accessToken || workspaceId === undefined || !wanted) return
        let active = true
        directoryFor({ accessToken, workspaceId }, wanted.split(',')).then(next => {
            if (active) setDirectory(next ?? 'unavailable')
        })
        return () => {
            active = false
        }
    }, [accessToken, workspaceId, wanted])

    return useCallback((authorId: string) => (directory === 'unavailable' ? undefined : directory ? (directory.get(authorId) ?? FORMER_MEMBER) : null), [directory])
}
