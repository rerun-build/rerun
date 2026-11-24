import { afterClosing, arrive, isRefusedStatus, MAX_OPEN_CHATS, OpenChatsSync, type ArrivalKind, type ResumeChat } from '@rerun/contracts'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { ApiError } from '@/api/client'
import { changeOpenChats, fetchOpenChats } from '@/api/open-chats'
import { useAuth } from '@/auth/AuthProvider'
import { chatDevice, readOpenChats, writeOpenChats, type StoredOpenChats } from '@/data/open-chats-store'

// Back and forth between two apps: one read covers it.
const RETURN_THROTTLE_MS = 5000

type Caller = { accessToken: string; workspaceId: number }

// One per coworker and person, so a chat opened again goes on with the changes still on their way.
// `caller` is the latest one known: a token may be refreshed while a change waits.
type Shared = { stored: StoredOpenChats; sync: OpenChatsSync; caller: Caller; save: () => void }
const shared = new Map<string, Shared>()

function sharedOf(key: string, agentId: string, caller: Caller): Shared {
    const known = shared.get(key)
    if (known) {
        known.caller = caller
        return known
    }
    const entry: Shared = {
        stored: readOpenChats(key, agentId),
        caller,
        save: () => writeOpenChats(key, entry.stored),
        sync: new OpenChatsSync({
            device: chatDevice(),
            memo: {
                read: () => entry.stored.memo,
                write: memo => {
                    entry.stored = { ...entry.stored, memo }
                    entry.save()
                },
            },
            read: () => fetchOpenChats(entry.caller, agentId),
            change: body => changeOpenChats(entry.caller, agentId, body),
            refused: error => error instanceof ApiError && isRefusedStatus(error.status),
        }),
    }
    shared.set(key, entry)
    return entry
}

function keepOpenIds(key: string, openIds: string[]) {
    const entry = shared.get(key)
    if (!entry || JSON.stringify(entry.stored.openIds) === JSON.stringify(openIds)) return
    entry.stored = { ...entry.stored, openIds }
    entry.save()
}

const withOpen = (openIds: string[], id: string) => (openIds.includes(id) ? openIds : [...openIds, id].slice(-MAX_OPEN_CHATS))

type OpenChatsOptions = {
    // The thread the chat opened on; null on General or a new one.
    openedOn: string | null
    // The conversation on screen: null for General, undefined for a draft.
    activeId: string | null | undefined
}

/**
 * The conversations left open on a coworker, the same on every device of the person: what the phone
 * remembers before the first frame, then what the hub holds. `resume` is the one picked last on another
 * device, offered over the composer.
 */
export function useOpenChats(agentId: string, { openedOn, activeId }: OpenChatsOptions) {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const userId = me?.user.id
    const entry = accessToken && workspaceId !== undefined && userId ? sharedOf(`${userId}-${workspaceId}-${agentId}`, agentId, { accessToken, workspaceId }) : null
    const [openIds, setOpenIds] = useState<string[]>(() => {
        const stored = entry?.stored.openIds ?? []
        return openedOn ? withOpen(stored, openedOn) : stored
    })
    const [resume, setResume] = useState<ResumeChat | null>(null)
    const key = entry ? `${userId}-${workspaceId}-${agentId}` : null
    // The account was still being read at the first frame: what the phone remembers joins what is on screen.
    const [shownKey, setShownKey] = useState(key)
    if (entry && key !== shownKey) {
        setShownKey(key)
        setOpenIds(current => current.reduce(withOpen, entry.stored.openIds))
    }

    useEffect(() => {
        if (key && shownKey === key) keepOpenIds(key, openIds)
    }, [key, shownKey, openIds])

    const latest = useRef({ openIds, activeId })
    useEffect(() => {
        latest.current = { openIds, activeId }
    }, [openIds, activeId])

    const load = useCallback(async (from: Shared, kind: ArrivalKind, alive: () => boolean) => {
        const settled = await from.sync.settle(() => latest.current)
        if (!settled || !alive()) return
        const { server, changedHere } = settled
        const arrival = arrive(server, { deviceId: chatDevice().id, activeId: latest.current.activeId, dismissedAt: from.sync.dismissedAt }, changedHere ? 'opened-on' : kind)
        setOpenIds(current => (JSON.stringify(current) === JSON.stringify(arrival.openIds) ? current : arrival.openIds))
        setResume(arrival.resume)
    }, [])

    const arrivalKind = useEffectEvent((): ArrivalKind => {
        if (openedOn) entry?.sync.record({ type: 'select', sessionId: openedOn })
        return openedOn || activeId !== null ? 'opened-on' : 'opening'
    })

    const returnedAt = useRef(0)
    useEffect(() => {
        const from = key ? shared.get(key) : undefined
        if (!from) return
        let alive = true
        void load(from, arrivalKind(), () => alive)
        returnedAt.current = Date.now()
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                void from.sync.flush()
                return
            }
            if (Date.now() - returnedAt.current < RETURN_THROTTLE_MS) return
            returnedAt.current = Date.now()
            void load(from, 'returning', () => alive)
        })
        return () => {
            alive = false
            subscription.remove()
            void from.sync.flush()
        }
    }, [key, load])

    // `null` is General. Whatever was offered is settled by the pick.
    const select = useCallback(
        (id: string | null) => {
            if (id) setOpenIds(current => withOpen(current, id))
            setResume(null)
            entry?.sync.record({ type: 'select', sessionId: id })
        },
        [entry]
    )

    // The conversation that takes its place: the next one, the last one, or General (null).
    const close = useCallback(
        (id: string): string | null => {
            setOpenIds(openIds.filter(other => other !== id))
            setResume(current => (current?.sessionId === id ? null : current))
            entry?.sync.record({ type: 'close', sessionId: id })
            return afterClosing(openIds, id)
        },
        [entry, openIds]
    )

    const dismiss = useCallback(() => {
        if (resume) entry?.sync.dismiss(resume.changedAt)
        setResume(null)
    }, [entry, resume])

    const settle = useCallback(() => setResume(null), [])

    return { openIds, resume, select, close, dismiss, settle }
}
