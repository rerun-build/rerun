import { nextPinnedIds, RELEASE_DELAY_MS, settledPinnedIds, type SkillProposal, type SkillProposalDecision } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'

import { decideSkillProposal, fetchSkillProposals } from '@/api/chat'
import { useAuth } from '@/auth/AuthProvider'
import { translatorFor } from '@/i18n/translator'

// The writing job is bounded on the engine, so the poll can follow it to the end: quick at first,
// then relaxed for the minutes a CLI provider can take. The web's values.
const POLL_QUICK_MS = 1500
const POLL_RELAXED_MS = 10_000
const POLL_QUICK_WINDOW_MS = 60_000
const NONE: Map<string, SkillProposal> = new Map()
const NO_IDS: ReadonlySet<string> = new Set()

type Loaded = { sessionId: string | null; proposals: Map<string, SkillProposal>; pinnedIds: ReadonlySet<string> }

const EMPTY: Loaded = { sessionId: null, proposals: NONE, pinnedIds: NO_IDS }

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    return a.size === b.size && [...a].every(id => b.has(id))
}

function reload(current: Loaded, sessionId: string, proposals: Map<string, SkillProposal>): Loaded {
    const held = current.sessionId === sessionId ? current.pinnedIds : NO_IDS
    const next = nextPinnedIds(held, proposals.values())
    return { sessionId, proposals, pinnedIds: sameIds(held, next) ? held : next }
}

// The web's useSkillProposals: the rules a coworker offered to remember in one conversation, keyed by
// their own id (the transcript finds a row through the id the tool returned). `pinned` is what the dock
// above the composer holds, only what still waits on the person. Null `sessionId` for the Foreman,
// which proposes none, and for a conversation not created yet.
export function useSkillProposals(sessionId: string | null, busy: boolean) {
    const { session, me } = useAuth()
    const caller = useMemo(() => (session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null), [session, me])
    const [loaded, setLoaded] = useState<Loaded>(EMPTY)
    const [pendingId, setPendingId] = useState<string | null>(null)
    const releaseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const current = loaded.sessionId === sessionId ? loaded : EMPTY
    const { proposals, pinnedIds } = current

    const load = useCallback((rows: SkillProposal[]) => sessionId && setLoaded(previous => reload(previous, sessionId, new Map(rows.map(row => [row.id, row])))), [sessionId])

    const refresh = useCallback(async () => {
        if (!sessionId || !caller) return
        load(await fetchSkillProposals(caller, sessionId))
    }, [sessionId, caller, load])

    useEffect(() => {
        if (!sessionId || !caller) return
        let cancelled = false
        fetchSkillProposals(caller, sessionId)
            .then(rows => !cancelled && load(rows))
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [sessionId, caller, load])

    // A proposal is raised during a turn, so a new row can only exist once one is over.
    const wasBusy = useRef(busy)
    useEffect(() => {
        if (wasBusy.current && !busy) refresh().catch(() => {})
        wasBusy.current = busy
    }, [busy, refresh])

    const writing = useMemo(() => [...proposals.values()].some(proposal => proposal.status === 'accepted'), [proposals])
    useEffect(() => {
        if (!writing) return
        const startedAt = Date.now()
        let timer: ReturnType<typeof setTimeout>
        const tick = () => {
            refresh().catch(() => {})
            timer = setTimeout(tick, Date.now() - startedAt < POLL_QUICK_WINDOW_MS ? POLL_QUICK_MS : POLL_RELAXED_MS)
        }
        timer = setTimeout(tick, POLL_QUICK_MS)
        return () => clearTimeout(timer)
    }, [writing, refresh])

    // An app that slept through the writing catches up the moment it is back in front.
    useEffect(() => {
        if (!writing) return
        const subscription = AppState.addEventListener('change', state => state === 'active' && refresh().catch(() => {}))
        return () => subscription.remove()
    }, [writing, refresh])

    // A dismissed row stays up long enough to report its outcome where the person is looking, then
    // goes back to its own place in the transcript.
    useEffect(() => {
        const timers = releaseTimers.current
        for (const id of settledPinnedIds(pinnedIds, proposals.values())) {
            if (timers.has(id)) continue
            timers.set(
                id,
                setTimeout(() => {
                    timers.delete(id)
                    setLoaded(previous => {
                        if (!previous.pinnedIds.has(id)) return previous
                        const next = new Set(previous.pinnedIds)
                        next.delete(id)
                        return { ...previous, pinnedIds: next }
                    })
                }, RELEASE_DELAY_MS)
            )
        }
    }, [pinnedIds, proposals])

    useEffect(() => {
        const timers = releaseTimers.current
        return () => {
            for (const timer of timers.values()) clearTimeout(timer)
            timers.clear()
        }
    }, [])

    // Oldest first, so the freshest proposal sits closest to the composer.
    const pinned = useMemo(() => [...proposals.values()].filter(proposal => pinnedIds.has(proposal.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [proposals, pinnedIds])

    const decide = useCallback(
        async (proposalId: string, decision: SkillProposalDecision) => {
            if (!sessionId || !caller) return
            setPendingId(proposalId)
            try {
                const proposal = await decideSkillProposal(caller, sessionId, proposalId, decision)
                setLoaded(previous => (previous.sessionId === sessionId ? reload(previous, sessionId, new Map(previous.proposals).set(proposal.id, proposal)) : previous))
            } catch (error) {
                Alert.alert(translatorFor('mobileChat')('skillUpdateFailed'), error instanceof Error ? error.message : translatorFor('mobileCommon')('errors.tryAgainShortly'))
                refresh().catch(() => {})
            } finally {
                setPendingId(null)
            }
        },
        [sessionId, caller, refresh]
    )

    return { proposals, pinned, pinnedIds, decide, pendingId }
}

export type SkillProposals = ReturnType<typeof useSkillProposals>
