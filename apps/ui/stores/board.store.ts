import { deleteAgentAction, duplicateAgentAction, moveAgentAction, renameAgentAction } from '@/app/api/_actions/agent.actions'
import { BOX_MANAGE_ACTION_REASON, boxAccessFor, type BoxViewer, type SpaceGrant } from '@/lib/board/box-access'
import { duplicateAgentName } from '@/lib/copy-name'
import { startKickoffAction } from '@/app/api/_actions/chat.actions'
import type { KickoffResult } from '@/app/api/_services/kickoff.service'
import { createAgentWithSetupAction } from '@/app/api/_actions/services.actions'
import { findIdleSessionsAction } from '@/app/api/_actions/session.actions'
import { claimSpaceAction, deleteSpaceAction, renameSpaceAction } from '@/app/api/_actions/space.actions'
import { ATTENTION_STATUSES } from '@/lib/board/attention'
import type { SpaceRect, SpaceSide } from '@/lib/board/space-layout'
import { installSharedAgentAction } from '@/app/api/_actions/agent-share.actions'
import { installTemplateAction } from '@/app/api/_actions/template.actions'
import { fireRerunConfetti } from '@/lib/confetti'
import { clearPendingKickoff, readPendingKickoff, readPendingKickoffs, savePendingKickoff, type PendingKickoff } from '@/lib/onboarding/pending-kickoff'
import { reportDuplicate, reportInstall, reportShareInstall } from '@/lib/templates/install-feedback'
import { track } from '@rerun/analytics/client'
import { toast } from 'sonner'
import type { ReactNode } from 'react'
import { refusalText, translated } from '@/lib/i18n/toast-text'
import type { Database } from '@/app/api/database.types'
import { createClient } from '@/supabase/client'
import { selectMany } from '@/supabase/supabase-helpers'
import { create } from 'zustand'
import type { AgentFocusTab, AgentLink, GridPosition, InteractionMode, IsoAgent, SessionEntry, SessionStatus, SpacePublic } from '../lib/board/types'
import { agentFromRow, computeAgentStatus } from '../lib/board/types'
import { AGENT_SPAN, isPlaced } from '@/lib/board/iso'
import { fetchLiveSessions, sweepZombieSessions } from '@/lib/board/live-sessions'
import type { AgentSchedule } from '@/lib/board/next-runs'

function spaceAtPosition(spaces: SpacePublic[], pos: GridPosition) {
    return spaces.find(s => {
        const colMin = Math.min(s.col_start, s.col_end)
        const colMax = Math.max(s.col_start, s.col_end)
        const rowMin = Math.min(s.row_start, s.row_end)
        const rowMax = Math.max(s.row_start, s.row_end)
        return pos.col >= colMin && pos.col + (AGENT_SPAN - 1) <= colMax && pos.row >= rowMin && pos.row + (AGENT_SPAN - 1) <= rowMax
    })
}

function managesBoxes(state: { spaces: SpacePublic[]; spaceGrants: SpaceGrant[] }, viewer: BoxViewer, spaceIds: (string | null | undefined)[]) {
    return spaceIds.every(spaceId => boxAccessFor(viewer, spaceId ? state.spaces.find(s => s.id === spaceId) : undefined, state.spaceGrants) === 'manage')
}

export const BOX_REFUSAL_TOAST_ID = 'box-manage-refused'

export function refuseUnmanagedBox() {
    toast.error(refusalText({ error: BOX_MANAGE_ACTION_REASON, code: 'boxManagerOnly' }), { id: BOX_REFUSAL_TOAST_ID })
}

export type PendingAgentDraft = { name: string; description?: string; serviceSlugs: string[]; kickoff?: string }

type PlacementSource =
    | { kind: 'scratch'; draft: PendingAgentDraft }
    | { kind: 'template'; slug: string; title: string; again?: boolean }
    | { kind: 'share'; token: string; title: string }
    | { kind: 'duplicate'; agentId: string; title: string }

export type PlacementQueue = {
    source: PlacementSource
    labels: string[]
    placed: GridPosition[]
    spaceId: string | null
    installing: boolean
}

export function placementLabel(queue: PlacementQueue): string {
    return queue.labels[queue.placed.length] ?? queue.labels[queue.labels.length - 1] ?? ''
}

type BoardState = {
    agents: IsoAgent[]
    spaces: SpacePublic[]
    sessions: SessionEntry[]
    liveLinks: AgentLink[]
    agentOnlineMap: Record<string, boolean>
    agentEngineBusyMap: Record<string, boolean>
    agentSchedules: AgentSchedule[]
    schedulesRefreshKey: number
    mode: InteractionMode
    selectedAgentId: string | null
    agentFocusRequest: { agentId: string; tab: AgentFocusTab } | null
    agentFileFocus: { agentId: string; path: string } | null
    agentDataFocus: { agentId: string; table: string; view?: string } | null
    agentSkillFocus: { agentId: string; slug: string } | null
    agentScheduleFocus: { agentId: string; slug: string } | null
    justPlacedAgentId: string | null
    selectedSpaceId: string | null
    placingAgentId: string | null
    placement: PlacementQueue | null
    startingFirstAgent: boolean
    pendingSelectAgentId: string | null
    pendingOpenSession: { agentId: string; sessionId: string; runId: string | null; title?: string } | null
    _resizingSpaceId: string | null
    _movingSpaceId: string | null
    hydrated: boolean
    recenterSignal: number
    cameraFocus: { agentId: string; nonce: number } | null

    hydrate: (workspaceId: number) => Promise<void>
    reset: () => void
    beginAgentPlacement: (draft: PendingAgentDraft, spaceId?: string | null) => void
    beginTemplatePlacement: (template: { slug: string; title: string; agentNames: string[]; again?: boolean }) => void
    beginAgentSharePlacement: (share: { token: string; agentName: string }) => void
    beginAgentDuplicatePlacement: (agent: { agentId: string; agentName: string }) => void
    setStartingFirstAgent: (v: boolean) => void
    finalizeAgentCreation: (agentId: string, description?: string, kickoff?: string) => void
    sendPendingKickoff: (agentId?: string) => Promise<{ agentId: string; sessionId: string } | null>
    setPendingOpenSession: (open: { agentId: string; sessionId: string; runId: string | null; title?: string }) => void
    clearPendingOpenSession: () => void
    pushPlacement: (pos: GridPosition, spaceId: string | null) => { positions: GridPosition[]; done: boolean } | null
    confirmPlacement: (pos: GridPosition, viewer: BoxViewer) => void
    cancelPlacement: () => void
    moveAgent: (id: string, pos: GridPosition, spaceId: string | undefined, viewer: BoxViewer) => void
    moveAgentToBox: (id: string, spaceId: string, viewer: BoxViewer) => void
    renameAgent: (id: string, name: string) => void
    removeAgent: (id: string) => void
    setSessionStatus: (sessionId: string, status: SessionStatus) => void
    markSessionsHandled: (sessionIds: string[]) => void
    setLiveLinks: (links: AgentLink[]) => void
    setAgentOnline: (agentId: string, online: boolean) => void
    setAgentEngineBusy: (agentId: string, busy: boolean) => void
    setAgentSchedules: (schedules: AgentSchedule[]) => void
    requestSchedulesRefresh: () => void
    selectAgent: (id: string | null) => void
    openAgentChat: (id: string) => void
    openAgentFile: (agentId: string, path: string) => void
    clearAgentFileFocus: () => void
    openAgentData: (agentId: string, table: string, view?: string) => void
    clearAgentDataFocus: () => void
    openAgentSkill: (agentId: string, slug: string) => void
    clearAgentSkillFocus: () => void
    openAgentSchedule: (agentId: string, slug: string) => void
    clearAgentScheduleFocus: () => void
    openAgentSettings: (id: string) => void
    openAgentTab: (id: string, tab: AgentFocusTab) => void
    selectAgentWhenReady: (id: string) => void
    clearAgentFocus: () => void
    selectSpace: (id: string | null) => void
    recenterBoard: () => void
    focusAgentOnBoard: (id: string, tab?: AgentFocusTab) => void
    setMode: (mode: InteractionMode) => void
    claimSpace: (workspaceId: number, name: string, from?: { spaceId: string; side: SpaceSide }, viewer?: BoxViewer) => Promise<void>
    updateSpace: (id: string, patch: Partial<Pick<SpacePublic, 'col_start' | 'row_start' | 'col_end' | 'row_end' | 'name'>>, viewer: BoxViewer) => void
    moveSpace: (id: string, rect: SpaceRect, viewer: BoxViewer) => void
    _localActivateAgent: (id: string) => void
    _localUpdateSpace: (id: string, patch: Partial<Pick<SpacePublic, 'col_start' | 'row_start' | 'col_end' | 'row_end'>>) => void
    _setResizingSpaceId: (id: string | null) => void
    renameSpace: (id: string, name: string, viewer: BoxViewer) => void
    deleteSpace: (id: string, viewer: BoxViewer) => void
    spaceGrants: SpaceGrant[]
    setSpaceGrants: (grants: SpaceGrant[]) => void
    dropSpaces: (spaceIds: string[]) => boolean
    _realtimeInsertSpace: (space: SpacePublic) => void
    _realtimeUpdateSpace: (space: SpacePublic) => void
    _realtimeDeleteSpace: (id: string) => void
    _onAgentInsert: (agent: IsoAgent) => void
    _onAgentUpdate: (agent: IsoAgent) => void
    _onAgentDelete: (id: string) => void
    _onSessionInsert: (session: SessionEntry) => void
    _onSessionUpdate: (session: SessionEntry) => void
    _onSessionDelete: (sessionId: string) => void
    reconcileSessions: () => Promise<void>
    _recomputeAgentStatus: (agentId: string) => void
}

const supabase = createClient()

const kickoffsInFlight = new Map<string, Promise<KickoffResult>>()

function deliverKickoff(pending: PendingKickoff): Promise<KickoffResult> {
    const inFlight = kickoffsInFlight.get(pending.agentId)
    if (inFlight) return inFlight
    track('agent_run_started', { agent_id: pending.agentId })
    const delivery = startKickoffAction(pending.agentId, { kickoff: pending.kickoff, description: pending.description })
        .catch((err: unknown): KickoffResult => ({ ok: false, error: err instanceof Error ? err.message : 'Kickoff failed', agentGone: false }))
        .finally(() => kickoffsInFlight.delete(pending.agentId))
    kickoffsInFlight.set(pending.agentId, delivery)
    return delivery
}

function sameSession(a: SessionEntry, b: SessionEntry): boolean {
    return a.id === b.id && a.agentId === b.agentId && a.originAgentId === b.originAgentId && a.status === b.status
}

const initialState = {
    agents: [] as IsoAgent[],
    spaces: [] as SpacePublic[],
    sessions: [] as SessionEntry[],
    liveLinks: [] as AgentLink[],
    agentOnlineMap: {} as Record<string, boolean>,
    agentEngineBusyMap: {} as Record<string, boolean>,
    agentSchedules: [] as AgentSchedule[],
    schedulesRefreshKey: 0,
    mode: 'select' as InteractionMode,
    selectedAgentId: null,
    agentFocusRequest: null,
    agentFileFocus: null as { agentId: string; path: string } | null,
    agentDataFocus: null as { agentId: string; table: string; view?: string } | null,
    agentSkillFocus: null as { agentId: string; slug: string } | null,
    agentScheduleFocus: null as { agentId: string; slug: string } | null,
    justPlacedAgentId: null,
    selectedSpaceId: null,
    placingAgentId: null,
    placement: null as PlacementQueue | null,
    startingFirstAgent: false,
    pendingSelectAgentId: null as string | null,
    pendingOpenSession: null as { agentId: string; sessionId: string; runId: string | null; title?: string } | null,
    _resizingSpaceId: null,
    _movingSpaceId: null,
    spaceGrants: [] as SpaceGrant[],
    hydrated: false,
}

export const useBoardStore = create<BoardState>((set, get) => ({
    ...initialState,
    recenterSignal: 0,
    cameraFocus: null,

    reset: () => set({ ...initialState }),

    hydrate: async (workspaceId: number) => {
        const [agentsResult, spacesResult, grantsResult] = await Promise.all([
            selectMany(supabase, 'agents', ['id', 'name', 'handle', 'description', 'template_id', 'status', 'col', 'row', 'workspace_id', 'space_id', 'created_at', 'disabled_at', 'disabled_reason'] as const, { workspace_id: workspaceId }),
            selectMany(supabase, 'spaces', ['id', 'workspace_id', 'name', 'col_start', 'row_start', 'col_end', 'row_end', 'created_at', 'visibility'] as const, { workspace_id: workspaceId }),
            selectMany(supabase, 'space_members', ['space_id', 'user_id', 'access'] as const, { workspace_id: workspaceId }),
        ])

        const dbAgents = agentsResult.data ? agentsResult.data.map(agentFromRow) : []
        const dbSpaces = spacesResult.data ?? []

        const agentIds = dbAgents.map(a => a.id)
        const dbSessions = (agentIds.length > 0 ? await fetchLiveSessions(supabase, agentIds) : []) ?? []

        const onlineMap: Record<string, boolean> = {}
        for (const a of dbAgents) {
            onlineMap[a.id] = true
        }

        const agentsWithStatus = dbAgents.map(a => {
            const agentSessions = dbSessions.filter(s => s.agentId === a.id)
            return { ...a, status: computeAgentStatus(agentSessions, onlineMap[a.id] ?? true) }
        })

        set({ agents: agentsWithStatus, spaces: dbSpaces, sessions: dbSessions, spaceGrants: grantsResult.data ?? [], agentOnlineMap: onlineMap, hydrated: true })

        void sweepZombieSessions(supabase, dbSessions.map(session => ({ ...session })), findIdleSessionsAction).then(zombieIds => {
            if (zombieIds.length === 0) return
            const zombies = new Set(zombieIds)
            set(state => {
                const sessions = state.sessions.map(session => (zombies.has(session.id) && session.status === 'working' ? { ...session, status: 'idle' as const } : session))
                const agents = state.agents.map(a => {
                    const status = computeAgentStatus(sessions.filter(session => session.agentId === a.id), state.agentOnlineMap[a.id] ?? true, state.agentEngineBusyMap[a.id] ?? false)
                    return status === a.status ? a : { ...a, status }
                })
                return { sessions, agents }
            })
        })
    },

    beginAgentPlacement: (draft, spaceId = null) => {
        set({ placement: { source: { kind: 'scratch', draft }, labels: [draft.name], placed: [], spaceId, installing: false }, selectedAgentId: null, selectedSpaceId: null })
    },

    beginTemplatePlacement: template => {
        set({ placement: { source: { kind: 'template', slug: template.slug, title: template.title, again: template.again }, labels: template.agentNames, placed: [], spaceId: null, installing: false }, selectedAgentId: null, selectedSpaceId: null })
    },

    beginAgentSharePlacement: share => {
        set({ placement: { source: { kind: 'share', token: share.token, title: share.agentName }, labels: [share.agentName], placed: [], spaceId: null, installing: false }, selectedAgentId: null, selectedSpaceId: null })
    },

    beginAgentDuplicatePlacement: agent => {
        set({
            placement: { source: { kind: 'duplicate', agentId: agent.agentId, title: agent.agentName }, labels: [duplicateAgentName(agent.agentName)], placed: [], spaceId: null, installing: false },
            selectedAgentId: null,
            selectedSpaceId: null,
        })
    },

    setStartingFirstAgent: v => {
        set({ startingFirstAgent: v })
    },

    finalizeAgentCreation: (agentId, description, kickoff) => {
        if (kickoff || description) savePendingKickoff({ agentId, kickoff, description })
        void fireRerunConfetti()
        get().openAgentChat(agentId)
        void get().sendPendingKickoff(agentId)
    },

    sendPendingKickoff: async agentId => {
        const pending = agentId ? [readPendingKickoff(agentId)].filter(entry => entry !== null) : readPendingKickoffs()
        const sent = await Promise.all(
            pending.map(async entry => {
                const res = await deliverKickoff(entry)
                if (!res.ok) {
                    track('agent_run_failed', { error_type: res.agentGone ? 'agent_gone' : 'kickoff_error' })
                    if (res.agentGone) clearPendingKickoff(entry.agentId)
                    return null
                }
                clearPendingKickoff(entry.agentId)
                return { agentId: entry.agentId, sessionId: res.sessionId, runId: res.runId }
            })
        )
        const opened = sent.filter(result => result !== null).at(-1)
        if (!opened) return null
        set({ pendingOpenSession: opened })
        return { agentId: opened.agentId, sessionId: opened.sessionId }
    },

    setPendingOpenSession: open => {
        set({ pendingOpenSession: open })
    },

    clearPendingOpenSession: () => {
        set({ pendingOpenSession: null })
    },

    pushPlacement: (pos, spaceId) => {
        const { placement } = get()
        if (!placement || placement.installing) return null
        if (placement.spaceId && spaceId && placement.spaceId !== spaceId) return null

        const placed = [...placement.placed, pos]
        const done = placed.length >= placement.labels.length
        set({ placement: { ...placement, placed, spaceId: spaceId ?? placement.spaceId, installing: done } })
        return { positions: placed, done }
    },

    confirmPlacement: (pos, viewer) => {
        const { placingAgentId, placement, spaces } = get()

        if (placement) {
            const space = spaceAtPosition(spaces, pos)
            if (!space) return
            if (!managesBoxes(get(), viewer, [space.id])) {
                refuseUnmanagedBox()
                return
            }

            const step = get().pushPlacement(pos, space.id)
            if (!step?.done) return

            const source = placement.source
            ;(async () => {
                try {
                    if (source.kind === 'scratch') {
                        const draft = source.draft
                        const res = await createAgentWithSetupAction({ serviceSlugs: draft.serviceSlugs, name: draft.name, description: draft.description, workspaceId: space.workspace_id as number, spaceId: space.id, col: pos.col, row: pos.row })
                        if (!res.ok) return
                        if (!res.active) toast.warning(translated('builder.boardToasts.createdInactive', { name: draft.name }), { description: translated('builder.boardToasts.createdInactiveHint') })
                        get().finalizeAgentCreation(res.agentId, draft.description, draft.kickoff)
                        return
                    }

                    if (source.kind === 'share') {
                        const res = await installSharedAgentAction({ token: source.token, spaceId: space.id, position: pos })
                        if (!res.ok) {
                            toast.error(translated('builder.boardToasts.addFailed'), { description: refusalText(res) })
                            return
                        }
                        track('agent_share_installed', { inactive: res.inactive })
                        reportShareInstall(res)
                        get().selectAgentWhenReady(res.agentId)
                        return
                    }

                    if (source.kind === 'duplicate') {
                        const res = await duplicateAgentAction({ agentId: source.agentId, spaceId: space.id, position: pos })
                        if (!res.ok) {
                            toast.error(translated('builder.boardToasts.duplicateFailed'), { description: refusalText(res) })
                            return
                        }
                        track('agent_duplicated', { schedules: res.schedules.length, triggers: res.triggers.length })
                        reportDuplicate(res)
                        get().selectAgentWhenReady(res.agentId)
                        return
                    }

                    const res = await installTemplateAction({ slug: source.slug, spaceId: space.id, positions: step.positions, again: source.again })
                    if (!res.ok) {
                        toast.error(translated('builder.boardToasts.importFailed'), { description: refusalText(res) })
                        return
                    }
                    track('template_import_completed', { slug: source.slug, imported: res.imported, failed: res.failed.length })
                    reportInstall(res, source.title)
                    if (res.agentIds[0]) get().selectAgentWhenReady(res.agentIds[0])
                } catch (err) {
                    if (source.kind !== 'scratch') toast.error(translated('builder.boardToasts.importInterrupted'), { description: err instanceof Error ? err.message : translated('builder.boardToasts.importInterruptedHint') })
                } finally {
                    set({ placement: null })
                }
            })()
            return
        }

        if (!placingAgentId) return

        const target = spaceAtPosition(get().spaces, pos)
        if (!target) return
        if (!managesBoxes(get(), viewer, [target.id])) {
            refuseUnmanagedBox()
            return
        }

        set(state => ({
            agents: state.agents.map(a => (a.id === placingAgentId ? { ...a, position: pos, spaceId: target.id } : a)),
            placingAgentId: null,
        }))
        supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ col: pos.col, row: pos.row, space_id: target.id }).eq('id', placingAgentId).then()
    },

    cancelPlacement: () => {
        const { placingAgentId, placement } = get()

        if (placement) {
            set({ placement: null })
            return
        }

        if (!placingAgentId) return

        supabase.from('agents').delete().eq('id', placingAgentId).then()

        set({ placingAgentId: null })
    },

    moveAgent: (id, pos, spaceId, viewer) => {
        const previous = get().agents.find(a => a.id === id)
        const target = spaceId && get().spaces.some(s => s.id === spaceId) ? spaceId : undefined
        if (!managesBoxes(get(), viewer, [previous?.spaceId, target ?? previous?.spaceId])) {
            refuseUnmanagedBox()
            return
        }

        set(state => ({
            agents: state.agents.map(a => (a.id === id ? { ...a, position: pos, spaceId: target ?? a.spaceId } : a)),
        }))

        const patch: Database['public']['Tables']['agents']['Update'] = target ? { col: pos.col, row: pos.row, space_id: target } : { col: pos.col, row: pos.row }
        supabase
            .from('agents')
            .update<Database['public']['Tables']['agents']['Update']>(patch)
            .eq('id', id)
            .then(({ error }) => {
                if (!error || !previous) return
                set(state => ({
                    agents: state.agents.map(a => (a.id === id && a.position.col === pos.col && a.position.row === pos.row ? { ...a, position: previous.position, spaceId: previous.spaceId } : a)),
                }))
                toast.error(translated('builder.boardToasts.moveAgentFailed'))
            })
    },

    moveAgentToBox: (id, spaceId, viewer) => {
        if (!managesBoxes(get(), viewer, [get().agents.find(a => a.id === id)?.spaceId, spaceId])) {
            refuseUnmanagedBox()
            return
        }
        moveAgentAction({ agentId: id, spaceId }).then(res => {
            if (!res.ok) {
                toast.error(translated('builder.boardToasts.moveAgentFailed'), { description: refusalText(res) })
                return
            }
            set(state => ({ agents: state.agents.map(a => (a.id === id ? { ...a, spaceId, position: res.position } : a)) }))
        })
    },

    renameAgent: (id, name) => {
        set(state => ({
            agents: state.agents.map(a => (a.id === id ? { ...a, name } : a)),
        }))
        renameAgentAction(id, name)
            .then(res => set(state => ({ agents: state.agents.map(a => (a.id === id ? { ...a, handle: res.handle } : a)) })))
            .catch(() => {})
    },

    removeAgent: id => {
        deleteAgentAction(id).catch(() => {})
    },

    setSessionStatus: (sessionId, status) => {
        supabase.from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ status }).eq('id', sessionId).then()
        const session = get().sessions.find(s => s.id === sessionId)
        if (session) {
            set(state => ({
                sessions: state.sessions.map(s => (s.id === sessionId ? { ...s, status } : s)),
            }))
            get()._recomputeAgentStatus(session.agentId)
        }
    },

    markSessionsHandled: sessionIds => {
        const requested = new Set(sessionIds)
        const targets = get().sessions.filter(s => requested.has(s.id) && ATTENTION_STATUSES.has(s.status))
        if (targets.length === 0) return

        const ids = targets.map(s => s.id)

        supabase
            .from('sessions')
            .update<Database['public']['Tables']['sessions']['Update']>({ status: 'idle' })
            .in('id', ids)
            .in('status', [...ATTENTION_STATUSES])
            .then()

        const cleared = new Set(ids)
        const agentIds = new Set(targets.map(s => s.agentId))
        set(state => ({
            sessions: state.sessions.map(s => (cleared.has(s.id) ? { ...s, status: 'idle' as SessionStatus } : s)),
        }))
        for (const agentId of agentIds) get()._recomputeAgentStatus(agentId)
    },

    setLiveLinks: links => {
        set(state => {
            const prev = state.liveLinks
            if (prev.length === links.length && prev.every((p, i) => p.source === links[i].source && p.target === links[i].target)) {
                return {}
            }
            return { liveLinks: links }
        })
    },

    setAgentOnline: (agentId, online) => {
        set(state => ({
            agentOnlineMap: { ...state.agentOnlineMap, [agentId]: online },
        }))
        get()._recomputeAgentStatus(agentId)
    },

    setAgentSchedules: schedules => set({ agentSchedules: schedules }),
    requestSchedulesRefresh: () => set(state => ({ schedulesRefreshKey: state.schedulesRefreshKey + 1 })),

    setAgentEngineBusy: (agentId, busy) => {
        set(state => ({
            agentEngineBusyMap: { ...state.agentEngineBusyMap, [agentId]: busy },
        }))
        get()._recomputeAgentStatus(agentId)
    },

    selectAgent: id => {
        set(state => ({
            selectedAgentId: id,
            agentFileFocus: state.agentFileFocus?.agentId === id ? state.agentFileFocus : null,
            agentDataFocus: state.agentDataFocus?.agentId === id ? state.agentDataFocus : null,
            agentSkillFocus: state.agentSkillFocus?.agentId === id ? state.agentSkillFocus : null,
            agentScheduleFocus: state.agentScheduleFocus?.agentId === id ? state.agentScheduleFocus : null,
        }))
    },

    openAgentChat: id => {
        get().openAgentTab(id, 'chat')
    },

    openAgentSettings: id => {
        get().openAgentTab(id, 'settings')
    },

    openAgentTab: (id, tab) => {
        set({ selectedAgentId: id, selectedSpaceId: null, agentFocusRequest: { agentId: id, tab }, agentFileFocus: null, agentDataFocus: null, agentSkillFocus: null, agentScheduleFocus: null })
    },

    openAgentFile: (agentId, path) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: null, agentDataFocus: null, agentSkillFocus: null, agentScheduleFocus: null, agentFileFocus: { agentId, path } })
    },

    openAgentData: (agentId, table, view) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: null, agentFileFocus: null, agentSkillFocus: null, agentScheduleFocus: null, agentDataFocus: { agentId, table, view } })
    },

    openAgentSkill: (agentId, slug) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: { agentId, tab: 'skills' }, agentFileFocus: null, agentDataFocus: null, agentScheduleFocus: null, agentSkillFocus: { agentId, slug } })
    },

    openAgentSchedule: (agentId, slug) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: { agentId, tab: 'scheduled' }, agentFileFocus: null, agentDataFocus: null, agentSkillFocus: null, agentScheduleFocus: { agentId, slug } })
    },

    selectAgentWhenReady: id => {
        if (get().agents.some(a => a.id === id)) {
            get().openAgentChat(id)
            return
        }
        set({ pendingSelectAgentId: id })
    },

    clearAgentFocus: () => {
        set({ agentFocusRequest: null })
    },

    clearAgentFileFocus: () => {
        set({ agentFileFocus: null })
    },

    clearAgentDataFocus: () => {
        set({ agentDataFocus: null })
    },

    clearAgentSkillFocus: () => {
        set({ agentSkillFocus: null })
    },

    clearAgentScheduleFocus: () => {
        set({ agentScheduleFocus: null })
    },

    selectSpace: id => {
        set({ selectedSpaceId: id })
    },

    setMode: mode => {
        set({ mode, selectedSpaceId: null })
    },

    recenterBoard: () => {
        set(state => ({ recenterSignal: state.recenterSignal + 1 }))
    },

    focusAgentOnBoard: (id, tab) => {
        if (tab) get().openAgentTab(id, tab)
        else get().selectAgent(id)
        set(state => ({ cameraFocus: { agentId: id, nonce: (state.cameraFocus?.nonce ?? 0) + 1 } }))
    },

    claimSpace: async (workspaceId, name, from, viewer) => {
        const result = await claimSpaceAction({ workspaceId, name: name.trim() || null, from })
        if (!result.ok) throw new Error(result.error)
        const userId = viewer?.userId
        if (!userId || viewer.role !== 'member') return
        set(state => ({
            spaceGrants: [...state.spaceGrants.filter(row => row.space_id !== result.spaceId || row.user_id !== userId), { space_id: result.spaceId, user_id: userId, access: 'manage' }],
        }))
    },

    updateSpace: (id, patch, viewer) => {
        if (!managesBoxes(get(), viewer, [id])) {
            refuseUnmanagedBox()
            return
        }
        set(state => ({
            spaces: state.spaces.map(s => (s.id === id ? { ...s, ...patch } : s)),
        }))
        supabase.from('spaces').update<Database['public']['Tables']['spaces']['Update']>(patch).eq('id', id).then()
    },

    moveSpace: (id, rect, viewer) => {
        const before = get().spaces.find(s => s.id === id)
        if (!before) return
        if (!managesBoxes(get(), viewer, [id])) {
            refuseUnmanagedBox()
            return
        }
        const from: SpaceRect = { col_start: before.col_start, row_start: before.row_start, col_end: before.col_end, row_end: before.row_end }
        const delta = { col: rect.col_start - from.col_start, row: rect.row_start - from.row_start }
        const carried = get()
            .agents.filter(a => a.spaceId === id && isPlaced(a.position))
            .map(a => ({ id: a.id, from: a.position, to: { col: a.position.col + delta.col, row: a.position.row + delta.row } }))

        const write = (spaceRect: SpaceRect, end: 'from' | 'to') =>
            Promise.all([
                supabase.from('spaces').update<Database['public']['Tables']['spaces']['Update']>(spaceRect).eq('id', id),
                ...carried.map(moved => supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ col: moved[end].col, row: moved[end].row }).eq('id', moved.id)),
            ]).then(results => results.some(r => r.error))

        set(state => ({
            _movingSpaceId: id,
            spaces: state.spaces.map(s => (s.id === id ? { ...s, ...rect } : s)),
            agents: state.agents.map(a => {
                const moved = carried.find(m => m.id === a.id)
                return moved ? { ...a, position: moved.to } : a
            }),
        }))
        write(rect, 'to')
            .catch(() => true)
            .then(failed => {
                if (!failed) return
                write(from, 'from').catch(() => {})
                set(state => ({
                    spaces: state.spaces.map(s => (s.id === id ? { ...s, ...from } : s)),
                    agents: state.agents.map(a => {
                        const moved = carried.find(m => m.id === a.id)
                        return moved && a.position.col === moved.to.col && a.position.row === moved.to.row ? { ...a, position: moved.from } : a
                    }),
                }))
                toast.error(translated('builder.boardToasts.moveBoxFailed'), { description: translated('builder.boardToasts.checkConnection') })
            })
            .finally(() => set(state => (state._movingSpaceId === id ? { _movingSpaceId: null } : {})))
    },

    _localActivateAgent: id => {
        set(state => ({
            agents: state.agents.map(a => (a.id === id ? { ...a, disabledAt: null, disabledReason: null } : a)),
        }))
    },

    _localUpdateSpace: (id, patch) => {
        set(state => ({
            spaces: state.spaces.map(s => (s.id === id ? { ...s, ...patch } : s)),
        }))
    },

    _setResizingSpaceId: id => {
        set({ _resizingSpaceId: id })
    },

    renameSpace: (id, name, viewer) => {
        if (!managesBoxes(get(), viewer, [id])) {
            refuseUnmanagedBox()
            return
        }
        renameSpaceAction(id, name).catch(() => {})
    },

    deleteSpace: (id, viewer) => {
        if (!managesBoxes(get(), viewer, [id])) {
            refuseUnmanagedBox()
            return
        }
        const removed = get().spaces.find(s => s.id === id)
        set(state => ({
            spaces: state.spaces.filter(s => s.id !== id),
            selectedSpaceId: state.selectedSpaceId === id ? null : state.selectedSpaceId,
        }))
        const restore = (error: ReactNode) => {
            if (removed) set(state => (state.spaces.some(s => s.id === id) ? {} : { spaces: [...state.spaces, removed] }))
            toast.error(translated('builder.boardToasts.deleteBoxFailed'), { description: error })
        }
        deleteSpaceAction(id)
            .then(res => {
                if (!res.ok) restore(refusalText(res))
            })
            .catch(err => restore(err instanceof Error ? err.message : translated('builder.boardToasts.checkConnection')))
    },

    setSpaceGrants: grants => set({ spaceGrants: grants }),

    dropSpaces: spaceIds => {
        const dropped = new Set(spaceIds)
        const state = get()
        const goneAgents = new Set(state.agents.filter(agent => dropped.has(agent.spaceId)).map(agent => agent.id))
        if (!goneAgents.size && !state.spaces.some(space => dropped.has(space.id))) return false
        const closesPanel = !!state.selectedAgentId && goneAgents.has(state.selectedAgentId)
        set({
            spaces: state.spaces.filter(space => !dropped.has(space.id)),
            agents: state.agents.filter(agent => !goneAgents.has(agent.id)),
            sessions: state.sessions.filter(session => !goneAgents.has(session.agentId)),
            selectedSpaceId: state.selectedSpaceId && dropped.has(state.selectedSpaceId) ? null : state.selectedSpaceId,
            ...(closesPanel ? { selectedAgentId: null, agentFocusRequest: null } : {}),
        })
        return closesPanel
    },

    _realtimeInsertSpace: space => {
        const framing = !get().placingAgentId && !get().placement
        set(state => ({
            spaces: state.spaces.some(s => s.id === space.id) ? state.spaces : [...state.spaces, space],
            startingFirstAgent: false,
            ...(framing ? { recenterSignal: state.recenterSignal + 1 } : {}),
        }))
    },

    _realtimeUpdateSpace: space => {
        if (get()._resizingSpaceId === space.id || get()._movingSpaceId === space.id) return
        if (!get().spaces.some(s => s.id === space.id)) {
            void get()
                .hydrate(space.workspace_id)
                .then(() => {
                    if (!get().placingAgentId && !get().placement) get().recenterBoard()
                })
            return
        }
        set(state => ({
            spaces: state.spaces.map(s => (s.id === space.id ? { ...s, ...space } : s)),
        }))
    },

    _realtimeDeleteSpace: id => {
        set(state => ({
            spaces: state.spaces.filter(s => s.id !== id),
            selectedSpaceId: state.selectedSpaceId === id ? null : state.selectedSpaceId,
        }))
    },

    _onAgentInsert: agent => {
        const isNew = !get().agents.some(a => a.id === agent.id)
        set(state => ({
            agents: isNew ? [...state.agents, agent] : state.agents,
            agentOnlineMap: { ...state.agentOnlineMap, [agent.id]: true },
            ...(isNew ? { justPlacedAgentId: agent.id } : {}),
        }))
        get()._recomputeAgentStatus(agent.id)
        if (get().pendingSelectAgentId === agent.id) {
            set({ pendingSelectAgentId: null })
            get().openAgentChat(agent.id)
        }
        if (isNew) {
            const id = agent.id
            setTimeout(() => {
                if (get().justPlacedAgentId === id) set({ justPlacedAgentId: null })
            }, 1200)
        }
    },

    _onAgentUpdate: agent => {
        const { sessions, agentOnlineMap } = get()
        const agentSessions = sessions.filter(s => s.agentId === agent.id)
        const updated = { ...agent, status: computeAgentStatus(agentSessions, agentOnlineMap[agent.id] ?? true) }
        set(state => ({
            agents: state.agents.map(a => (a.id !== agent.id ? a : state._movingSpaceId && a.spaceId === state._movingSpaceId ? { ...updated, position: a.position, spaceId: a.spaceId } : updated)),
        }))
    },

    _onAgentDelete: id => {
        set(state => ({
            agents: state.agents.filter(a => a.id !== id),
            sessions: state.sessions.filter(s => s.agentId !== id),
            selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
            agentFocusRequest: state.agentFocusRequest?.agentId === id ? null : state.agentFocusRequest,
            agentFileFocus: state.agentFileFocus?.agentId === id ? null : state.agentFileFocus,
            agentDataFocus: state.agentDataFocus?.agentId === id ? null : state.agentDataFocus,
            agentSkillFocus: state.agentSkillFocus?.agentId === id ? null : state.agentSkillFocus,
            agentScheduleFocus: state.agentScheduleFocus?.agentId === id ? null : state.agentScheduleFocus,
            justPlacedAgentId: state.justPlacedAgentId === id ? null : state.justPlacedAgentId,
            placingAgentId: state.placingAgentId === id ? null : state.placingAgentId,
        }))
    },

    _onSessionInsert: session => {
        set(state => ({
            sessions: state.sessions.some(s => s.id === session.id) ? state.sessions : [...state.sessions, session],
        }))
        get()._recomputeAgentStatus(session.agentId)
    },

    _onSessionUpdate: session => {
        const known = get().sessions.find(s => s.id === session.id)
        if (known && sameSession(known, session)) return
        set(state => ({
            sessions: known ? state.sessions.map(s => (s.id === session.id ? session : s)) : [...state.sessions, session],
        }))
        get()._recomputeAgentStatus(session.agentId)
    },

    _onSessionDelete: sessionId => {
        const session = get().sessions.find(s => s.id === sessionId)
        set(state => ({
            sessions: state.sessions.filter(s => s.id !== sessionId),
        }))
        if (session) get()._recomputeAgentStatus(session.agentId)
    },

    reconcileSessions: async () => {
        const agentIds = get().agents.map(a => a.id)
        if (agentIds.length === 0) return
        const sessions = await fetchLiveSessions(supabase, agentIds)
        if (!sessions) return
        set(state => {
            const agents = state.agents.map(a => {
                const status = computeAgentStatus(sessions.filter(s => s.agentId === a.id), state.agentOnlineMap[a.id] ?? true, state.agentEngineBusyMap[a.id] ?? false)
                return status === a.status ? a : { ...a, status }
            })
            const unchangedSessions = state.sessions.length === sessions.length && state.sessions.every((s, i) => sameSession(s, sessions[i]))
            const unchangedAgents = agents.every((a, i) => a === state.agents[i])
            return { ...(unchangedSessions ? {} : { sessions }), ...(unchangedAgents ? {} : { agents }) }
        })
    },

    _recomputeAgentStatus: agentId => {
        const { sessions, agentOnlineMap, agentEngineBusyMap } = get()
        const agentSessions = sessions.filter(s => s.agentId === agentId)
        const newStatus = computeAgentStatus(agentSessions, agentOnlineMap[agentId] ?? true, agentEngineBusyMap[agentId] ?? false)
        set(state => {
            const known = state.agents.find(a => a.id === agentId)
            if (!known || known.status === newStatus) return {}
            return { agents: state.agents.map(a => (a.id === agentId ? { ...a, status: newStatus } : a)) }
        })
    },
}))
