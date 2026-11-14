'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { decideSkillProposalAction, listSkillProposalsAction } from '@/app/api/_actions/skill-proposal.actions'
import { nextPinnedIds, RELEASE_DELAY_MS, settledPinnedIds } from '@rerun/contracts'
import type { EngineSkillProposal } from '@/lib/engine/types'

const POLL_QUICK_MS = 1500
const POLL_RELAXED_MS = 10_000
const POLL_QUICK_WINDOW_MS = 60_000
const NONE: Map<string, EngineSkillProposal> = new Map()
const NO_IDS: ReadonlySet<string> = new Set()

type Loaded = { sessionId: string | null; proposals: Map<string, EngineSkillProposal>; pinnedIds: ReadonlySet<string> }

const EMPTY: Loaded = { sessionId: null, proposals: NONE, pinnedIds: NO_IDS }

function byId(proposals: EngineSkillProposal[]): Map<string, EngineSkillProposal> {
    return new Map(proposals.map(p => [p.id, p]))
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    return a.size === b.size && [...a].every(id => b.has(id))
}

function reload(current: Loaded, sessionId: string, proposals: Map<string, EngineSkillProposal>): Loaded {
    const held = current.sessionId === sessionId ? current.pinnedIds : NO_IDS
    const next = nextPinnedIds(held, proposals.values())
    return { sessionId, proposals, pinnedIds: sameIds(held, next) ? held : next }
}

export function useSkillProposals(sessionId: string | null, runStatus: string) {
    const [loaded, setLoaded] = useState<Loaded>(EMPTY)
    const [pendingId, setPendingId] = useState<string | null>(null)
    const errorText = useErrorText()
    const releaseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const current = loaded.sessionId === sessionId ? loaded : EMPTY
    const { proposals, pinnedIds } = current

    const refresh = useCallback(async () => {
        if (!sessionId) return
        const rows = await listSkillProposalsAction(sessionId)
        setLoaded(previous => reload(previous, sessionId, byId(rows)))
    }, [sessionId])

    const previousStatusRef = useRef(runStatus)
    useEffect(() => {
        const previous = previousStatusRef.current
        previousStatusRef.current = runStatus
        if (runStatus === 'streaming' || runStatus === 'submitted') return
        if (previous !== 'streaming' && previous !== 'submitted') return
        refresh().catch(() => {})
    }, [runStatus, refresh])

    const seed = useCallback((forSessionId: string, rows: EngineSkillProposal[]) => {
        setLoaded(previous => reload(previous, forSessionId, byId(rows)))
    }, [])

    const writing = useMemo(() => [...proposals.values()].some(p => p.status === 'accepted'), [proposals])
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

    useEffect(() => {
        if (!writing) return
        const onVisible = () => {
            if (document.visibilityState === 'visible') refresh().catch(() => {})
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [writing, refresh])

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

    const pinned = useMemo(() => [...proposals.values()].filter(p => pinnedIds.has(p.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [proposals, pinnedIds])

    const decide = useCallback(
        async (proposalId: string, decision: 'accept' | 'dismiss') => {
            if (!sessionId) return
            setPendingId(proposalId)
            try {
                const result = await decideSkillProposalAction(sessionId, proposalId, decision)
                if (result.error) toast.error(errorText(result))
                if (!result.proposal) return void refresh()
                const proposal = result.proposal
                setLoaded(previous => (previous.sessionId === sessionId ? reload(previous, sessionId, new Map(previous.proposals).set(proposal.id, proposal)) : previous))
            } finally {
                setPendingId(null)
            }
        },
        [sessionId, refresh, errorText]
    )

    return { proposals, pinned, pinnedIds, decide, pendingId, refresh, seed }
}

export type SkillProposals = ReturnType<typeof useSkillProposals>
