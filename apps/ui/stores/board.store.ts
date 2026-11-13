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

// La Box dans laquelle une tuile est posée se lit sur le plan : un agent est dessiné à ses propres
// col/row quelle que soit la Box qui le possède, donc c'est la géométrie qui décide de qui l'a.
function spaceAtPosition(spaces: SpacePublic[], pos: GridPosition) {
    return spaces.find(s => {
        const colMin = Math.min(s.col_start, s.col_end)
        const colMax = Math.max(s.col_start, s.col_end)
        const rowMin = Math.min(s.row_start, s.row_end)
        const rowMax = Math.max(s.row_start, s.row_end)
        return pos.col >= colMin && pos.col + (AGENT_SPAN - 1) <= colMax && pos.row >= rowMin && pos.row + (AGENT_SPAN - 1) <= rowMax
    })
}

// The board's own writes go straight to the database: a Box the caller only uses is refused here,
// before RLS would refuse it in silence.
function managesBoxes(state: { spaces: SpacePublic[]; spaceGrants: SpaceGrant[] }, viewer: BoxViewer, spaceIds: (string | null | undefined)[]) {
    return spaceIds.every(spaceId => boxAccessFor(viewer, spaceId ? state.spaces.find(s => s.id === spaceId) : undefined, state.spaceGrants) === 'manage')
}

export const BOX_REFUSAL_TOAST_ID = 'box-manage-refused'

export function refuseUnmanagedBox() {
    toast.error(refusalText({ error: BOX_MANAGE_ACTION_REASON, code: 'boxManagerOnly' }), { id: BOX_REFUSAL_TOAST_ID })
}

// Brouillon d'agent en attente de placement : le modal récolte ces champs, puis on entre en
// mode placement. L'agent n'est créé (engine + DB) qu'au drop, une fois l'espace déduit de la tuile.
export type PendingAgentDraft = { name: string; description?: string; serviceSlugs: string[]; kickoff?: string }

// Ce que le placement va poser : un agent parti de zéro, les agents capturés d'une template, ou
// l'agent unique qu'un lien de partage porte.
type PlacementSource =
    | { kind: 'scratch'; draft: PendingAgentDraft }
    | { kind: 'template'; slug: string; title: string; again?: boolean }
    | { kind: 'share'; token: string; title: string }
    | { kind: 'duplicate'; agentId: string; title: string }

// File de placement : une tuile à poser par agent, dans l'ordre d'installation. Rien n'est créé
// avant le dernier drop, pour qu'annuler en cours de route ne laisse aucun agent à moitié posé.
export type PlacementQueue = {
    source: PlacementSource
    labels: string[]
    placed: GridPosition[]
    // Verrouillé au premier drop : une template s'installe dans un seul space. Posé d'entrée quand
    // l'agent a été demandé depuis une Box.
    spaceId: string | null
    // Dernière tuile posée, création en cours. La file survit à ce moment pour que les tuiles
    // déjà posées restent affichées le temps que les vraies arrivent par realtime.
    installing: boolean
}

// What can be created on the board, before it is known where: dropped on the grid in the 3D view,
// straight into a Box in the Simple view. `spaceId` is the Box a scratch coworker was asked from.
export type CreationRequest =
    | { kind: 'scratch'; draft: PendingAgentDraft; spaceId?: string | null }
    | { kind: 'template'; slug: string; title: string; agentNames: string[]; again?: boolean }
    | { kind: 'share'; token: string; agentName: string }
    | { kind: 'duplicate'; agentId: string; agentName: string; spaceId?: string | null }

// Where a creation goes: placed by hand on the 3D grid, or put by the server in a Box of the list.
export type CreationFrame = 'board' | 'list'

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
    // Bumped by whoever just changed a schedule, so the board reloads them without waiting.
    schedulesRefreshKey: number
    mode: InteractionMode
    selectedAgentId: string | null
    agentFocusRequest: { agentId: string; tab: AgentFocusTab } | null
    agentFileFocus: { agentId: string; path: string } | null
    agentDataFocus: { agentId: string; table: string; view?: string } | null
    agentSkillFocus: { agentId: string; slug: string } | null
    agentScheduleFocus: { agentId: string; slug: string } | null
    justPlacedAgentId: string | null
    // Which rectangle is lit on the board. A Box has no panel of its own: what it holds, the whole
    // workspace holds, and that lives in the dialogs of the workspace menu.
    selectedSpaceId: string | null
    placingAgentId: string | null
    placement: PlacementQueue | null
    creationFrame: CreationFrame
    // A creation asked from the Simple view in a workspace with several Boxes: it waits for one.
    boxChoice: CreationRequest | null
    startingFirstAgent: boolean
    pendingSelectAgentId: string | null
    pendingOpenSession: { agentId: string; sessionId: string; runId: string | null; title?: string } | null
    _resizingSpaceId: string | null
    // La Box dont le déplacement s'écrit encore : le realtime ne doit pas la ramener, ni ses agents.
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
    setCreationFrame: (frame: CreationFrame) => void
    requestCreation: (request: CreationRequest, viewer: BoxViewer) => void
    chooseBox: (spaceId: string | null, viewer: BoxViewer) => void
    placeInBox: (request: CreationRequest, spaceId: string, viewer: BoxViewer) => Promise<void>
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
    // Sélectionne l'agent (sur un tab précis si demandé) et centre la caméra sur sa tuile.
    focusAgentOnBoard: (id: string, tab?: AgentFocusTab) => void
    setMode: (mode: InteractionMode) => void
    // `from` : la Box créée atterrit sur cette face de la Box source, au lieu d'être empilée en bas.
    // A member manages the Box they create: their grant is written here before realtime brings it,
    // so the new Box opens its controls the moment it lands.
    claimSpace: (workspaceId: number, name: string, from?: { spaceId: string; side: SpaceSide }, viewer?: BoxViewer) => Promise<void>
    updateSpace: (id: string, patch: Partial<Pick<SpacePublic, 'col_start' | 'row_start' | 'col_end' | 'row_end' | 'name'>>, viewer: BoxViewer) => void
    moveSpace: (id: string, rect: SpaceRect, viewer: BoxViewer) => void
    // L'activation est déjà écrite en base quand ceci est appelé : c'est du repaint immédiat, le
    // realtime repassera derrière avec la même valeur.
    _localActivateAgent: (id: string) => void
    _localUpdateSpace: (id: string, patch: Partial<Pick<SpacePublic, 'col_start' | 'row_start' | 'col_end' | 'row_end'>>) => void
    _setResizingSpaceId: (id: string | null) => void
    renameSpace: (id: string, name: string, viewer: BoxViewer) => void
    deleteSpace: (id: string, viewer: BoxViewer) => void
    // The caller's own `space_members` rows (every row of the workspace for an admin, as RLS returns
    // them). Read with the board so the buttons know which Boxes the caller manages.
    spaceGrants: SpaceGrant[]
    setSpaceGrants: (grants: SpaceGrant[]) => void
    // A Box the caller lost access to leaves the board with its coworkers, their sessions and any
    // panel open on one of them. Answers whether a coworker panel had to be closed.
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

// Single-flight sur l'envoi du kickoff, par agent : la fermeture du wizard et le rattrapage au boot
// peuvent se chevaucher, or l'entrée localStorage n'est effacée qu'après la réponse. Un seul envoi
// partagé entre agents faisait ouvrir, chez un agent créé juste après un autre, la conversation du
// premier, et son propre kickoff ne partait jamais.
const kickoffsInFlight = new Map<string, Promise<KickoffResult>>()

function deliverKickoff(pending: PendingKickoff): Promise<KickoffResult> {
    const inFlight = kickoffsInFlight.get(pending.agentId)
    if (inFlight) return inFlight
    track('agent_run_started', { agent_id: pending.agentId })
    // A dropped connection rejects the action instead of answering: the same transient failure
    // as an unreachable engine, so the entry stays for the replay at boot.
    const delivery = startKickoffAction(pending.agentId, { kickoff: pending.kickoff, description: pending.description })
        .catch((err: unknown): KickoffResult => ({ ok: false, error: err instanceof Error ? err.message : 'Kickoff failed', agentGone: false }))
        .finally(() => kickoffsInFlight.delete(pending.agentId))
    kickoffsInFlight.set(pending.agentId, delivery)
    return delivery
}

// Une écriture qui ne change rien recrée quand même `sessions` / `agents`, et toute la colonne de
// droite (un AgentPanelChat monté par agent visité, un AgentChat monté par conversation ouverte)
// se re-rend sur ce seul changement de référence. Les mutations du store sortent donc {} tant que
// la valeur est identique.
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
    boxChoice: null as CreationRequest | null,
    startingFirstAgent: false,
    pendingSelectAgentId: null as string | null,
    pendingOpenSession: null as { agentId: string; sessionId: string; runId: string | null; title?: string } | null,
    _resizingSpaceId: null,
    _movingSpaceId: null,
    spaceGrants: [] as SpaceGrant[],
    hydrated: false,
}

type Creator = Pick<BoardState, 'finalizeAgentCreation' | 'selectAgentWhenReady'>

// Creates what a placement or a Box picked in the list holds, in `space`. `positions` are the cells
// dropped on the grid; without them the server finds free ones, and a full Box leaves the coworker
// unplaced, listed, for the 3D view to offer a spot.
async function createFromSource(store: Creator, source: PlacementSource, space: Pick<SpacePublic, 'id' | 'workspace_id'>, positions: GridPosition[] | null): Promise<void> {
    const position = positions?.[0]
    try {
        if (source.kind === 'scratch') {
            const draft = source.draft
            const res = await createAgentWithSetupAction({ serviceSlugs: draft.serviceSlugs, name: draft.name, description: draft.description, workspaceId: space.workspace_id as number, spaceId: space.id, col: position?.col, row: position?.row })
            if (!res.ok) return
            // Le plan plafonne les agents actifs, pas les agents créés : celui-ci est
            // complet mais ne tournera pas tant qu'un slot ne s'est pas libéré.
            if (!res.active) toast.warning(translated('builder.boardToasts.createdInactive', { name: draft.name }), { description: translated('builder.boardToasts.createdInactiveHint') })
            store.finalizeAgentCreation(res.agentId, draft.description, draft.kickoff)
            return
        }

        if (source.kind === 'share') {
            const res = await installSharedAgentAction({ token: source.token, spaceId: space.id, position })
            if (!res.ok) {
                toast.error(translated('builder.boardToasts.addFailed'), { description: refusalText(res) })
                return
            }
            track('agent_share_installed', { inactive: res.inactive })
            reportShareInstall(res)
            store.selectAgentWhenReady(res.agentId)
            return
        }

        if (source.kind === 'duplicate') {
            const res = await duplicateAgentAction({ agentId: source.agentId, spaceId: space.id, position })
            if (!res.ok) {
                toast.error(translated('builder.boardToasts.duplicateFailed'), { description: refusalText(res) })
                return
            }
            track('agent_duplicated', { schedules: res.schedules.length, triggers: res.triggers.length })
            reportDuplicate(res)
            store.selectAgentWhenReady(res.agentId)
            return
        }

        const res = await installTemplateAction({ slug: source.slug, spaceId: space.id, positions: positions ?? undefined, again: source.again })
        if (!res.ok) {
            toast.error(translated('builder.boardToasts.importFailed'), { description: refusalText(res) })
            return
        }
        track('template_import_completed', { slug: source.slug, imported: res.imported, failed: res.failed.length })
        reportInstall(res, source.title)
        if (res.agentIds[0]) store.selectAgentWhenReady(res.agentIds[0])
    } catch (err) {
        // Un agent créé de zéro échoue en silence : l'insert realtime n'arrivera pas, rien
        // à nettoyer. Un import est plus long et peut mourir en vol (timeout, déploiement)
        // après avoir posé une partie du lot, donc on le dit plutôt que d'inviter à
        // réimporter par-dessus.
        if (source.kind !== 'scratch') toast.error(translated('builder.boardToasts.importInterrupted'), { description: err instanceof Error ? err.message : translated('builder.boardToasts.importInterruptedHint') })
    }
}

function sourceOf(request: CreationRequest): PlacementSource {
    if (request.kind === 'scratch') return { kind: 'scratch', draft: request.draft }
    if (request.kind === 'template') return { kind: 'template', slug: request.slug, title: request.title, again: request.again }
    if (request.kind === 'share') return { kind: 'share', token: request.token, title: request.agentName }
    return { kind: 'duplicate', agentId: request.agentId, title: request.agentName }
}

export const useBoardStore = create<BoardState>((set, get) => ({
    ...initialState,
    // Hors d'initialState à dessein : un compteur que reset() ramènerait à 0 se lirait comme un
    // nouvel ordre côté grille, qui ne compare que des valeurs.
    recenterSignal: 0,
    cameraFocus: null,
    // Outside initialState too: it is the frame on screen, which a workspace switch does not change.
    creationFrame: 'board',

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

        // The board shows first and the engine is asked after: a sweep that waits on a slow Box
        // would hold the whole board back for sessions that are, at worst, shown busy a moment
        // too long. Only a session still `working` by then is flipped, realtime may have moved it.
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

    // Un lien de partage ne porte qu'un agent, donc une seule tuile: la file se referme au premier
    // drop.
    beginAgentSharePlacement: share => {
        set({ placement: { source: { kind: 'share', token: share.token, title: share.agentName }, labels: [share.agentName], placed: [], spaceId: null, installing: false }, selectedAgentId: null, selectedSpaceId: null })
    },

    // Une copie ne fait qu'une tuile, comme un partage. Le nom montré sur le ghost est celui que le
    // serveur donnera vraiment à la copie : c'est le seul endroit où l'utilisateur le lit avant
    // qu'elle existe.
    beginAgentDuplicatePlacement: agent => {
        set({
            placement: { source: { kind: 'duplicate', agentId: agent.agentId, title: agent.agentName }, labels: [duplicateAgentName(agent.agentName)], placed: [], spaceId: null, installing: false },
            selectedAgentId: null,
            selectedSpaceId: null,
        })
    },

    setCreationFrame: creationFrame => set({ creationFrame }),

    // The one way in for anything created: the grid's placement queue in the 3D view, a Box in the
    // Simple view. There, a coworker asked from a Box goes to it (a copy to its original's), a
    // workspace with a single Box the caller manages uses it, and with several the caller picks one
    // (BoxPickerDialog).
    requestCreation: (request, viewer) => {
        if (get().creationFrame === 'board') {
            if (request.kind === 'scratch') get().beginAgentPlacement(request.draft, request.spaceId ?? null)
            else if (request.kind === 'template') get().beginTemplatePlacement(request)
            else if (request.kind === 'share') get().beginAgentSharePlacement(request)
            else get().beginAgentDuplicatePlacement(request)
            return
        }
        const asked = request.kind === 'scratch' || request.kind === 'duplicate' ? request.spaceId : null
        if (asked) {
            void get().placeInBox(request, asked, viewer)
            return
        }
        const manageable = get().spaces.filter(space => managesBoxes(get(), viewer, [space.id]))
        if (manageable.length === 0) {
            refuseUnmanagedBox()
            return
        }
        if (manageable.length === 1) {
            void get().placeInBox(request, manageable[0].id, viewer)
            return
        }
        set({ boxChoice: request })
    },

    chooseBox: (spaceId, viewer) => {
        const request = get().boxChoice
        set({ boxChoice: null })
        if (request && spaceId) void get().placeInBox(request, spaceId, viewer)
    },

    placeInBox: async (request, spaceId, viewer) => {
        const space = get().spaces.find(s => s.id === spaceId)
        if (!space) return
        if (!managesBoxes(get(), viewer, [space.id])) {
            refuseUnmanagedBox()
            return
        }
        await createFromSource(get(), sourceOf(request), space, null)
    },

    setStartingFirstAgent: v => {
        set({ startingFirstAgent: v })
    },

    finalizeAgentCreation: (agentId, description, kickoff) => {
        // Le premier message (kickoff) part côté serveur via sendPendingKickoff : parqué en
        // localStorage jusqu'à un envoi réussi pour survivre à un reload (rejoué au boot par
        // HomeContent). On envoie tout de suite et on ouvre le panel de l'agent. Les services
        // qui ont besoin de secrets restent à configurer ensuite via l'onglet Services du panel
        // (pastille de rappel sur l'onglet).
        if (kickoff || description) savePendingKickoff({ agentId, kickoff, description })
        // La pluie de logos salue l'agent qui atterrit pour de vrai, pas le drop sur le bloc fantôme :
        // en onboarding, celui-ci est suivi de la création de compte et du paiement.
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
                    // Cible disparue (agent supprimé, brouillon orphelin) : inutile de rejouer au boot.
                    // Sur erreur transitoire (engine injoignable), on garde l'entrée pour le rattrapage.
                    if (res.agentGone) clearPendingKickoff(entry.agentId)
                    return null
                }
                clearPendingKickoff(entry.agentId)
                return { agentId: entry.agentId, sessionId: res.sessionId, runId: res.runId }
            })
        )
        // Posé une fois, sur le kickoff renvoyé : le boot sélectionne cet agent-là, quel que soit
        // l'ordre dans lequel les envois ont répondu.
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

    // Empile un drop dans la file et dit si elle est complète. Ne crée rien : c'est l'appelant qui
    // sait si le board a un vrai space (création) ou seulement le bloc fantôme de l'onboarding
    // (brouillon parké jusqu'au retour de paiement).
    pushPlacement: (pos, spaceId) => {
        const { placement } = get()
        if (!placement || placement.installing) return null
        // Une template s'installe dans un seul space : les drops suivants sont bornés au premier.
        if (placement.spaceId && spaceId && placement.spaceId !== spaceId) return null

        const placed = [...placement.placed, pos]
        const done = placed.length >= placement.labels.length
        set({ placement: { ...placement, placed, spaceId: spaceId ?? placement.spaceId, installing: done } })
        return { positions: placed, done }
    },

    confirmPlacement: (pos, viewer) => {
        const { placingAgentId, placement, spaces } = get()

        // File en cours : l'espace est déduit de la tuile, et la création n'a lieu qu'au dernier drop.
        if (placement) {
            const space = spaceAtPosition(spaces, pos)
            if (!space) return // tuile hors de tout espace : le ghost était rouge, on ignore.
            if (!managesBoxes(get(), viewer, [space.id])) {
                refuseUnmanagedBox()
                return
            }

            const step = get().pushPlacement(pos, space.id)
            if (!step?.done) return

            const source = placement.source
            ;(async () => {
                try {
                    await createFromSource(get(), source, space, step.positions)
                } finally {
                    set({ placement: null })
                }
            })()
            return
        }

        // Legacy : repositionner un agent déjà créé mais non placé.
        if (!placingAgentId) return

        // Rien ne borne ce drop à la Box d'origine : sans reposer l'appartenance avec l'ancre, un
        // agent reposé ailleurs resterait la propriété de la Box qu'il vient de quitter.
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

        // File : rien n'a été créé avant le dernier drop, on jette simplement tout le lot.
        if (placement) {
            set({ placement: null })
            return
        }

        if (!placingAgentId) return

        supabase.from('agents').delete().eq('id', placingAgentId).then()

        set({ placingAgentId: null })
    },

    // Dropping an agent in another Box moves it there: same workspace, same machine, same folder
    // on the engine, only the rectangle it is drawn in changes. The composite foreign key on
    // (space_id, workspace_id) is what stops a crafted call from parking it in someone else's Box.
    moveAgent: (id, pos, spaceId, viewer) => {
        const previous = get().agents.find(a => a.id === id)
        // Le board porte aussi des containers qui ne sont pas des Box, comme le bloc fantôme de
        // l'onboarding : leur id n'a rien à faire dans space_id.
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
                // Un refus de la clé étrangère ou de la policy n'émet aucun realtime : sans ce
                // retour en arrière la tuile resterait garée dans une Box où elle n'est jamais
                // arrivée. On ne rembobine que si rien n'a bougé depuis.
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
        // Pas d'optimisme : c'est le serveur qui choisit la cellule libre, et l'annoncer avant de
        // la connaître ferait sauter la tuile deux fois.
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

    // Le garde sur le statut reprend celui de clearSessionAlert : une session repartie en `working`
    // entre le rendu de la liste et la confirmation appartient à son run, pas à l'accusé de lecture.
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
            // Évite un re-render si rien n'a changé (le poll tourne toutes les 10 s).
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

    // Sélectionne un agent et pose un signal transitoire pour que le panel s'ouvre sur le tab demandé
    // quel que soit l'onglet actif (consommé et effacé par AgentPanel).
    openAgentChat: id => {
        get().openAgentTab(id, 'chat')
    },

    openAgentSettings: id => {
        get().openAgentTab(id, 'settings')
    },

    openAgentTab: (id, tab) => {
        set({ selectedAgentId: id, selectedSpaceId: null, agentFocusRequest: { agentId: id, tab }, agentFileFocus: null, agentDataFocus: null, agentSkillFocus: null, agentScheduleFocus: null })
    },

    // File links in chat address the engine's absolute filesystem. The renderer strips that
    // prefix and sends the app-level agent id here, so the Files tab can use its authenticated
    // server actions rather than exposing an engine path to the browser.
    openAgentFile: (agentId, path) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: null, agentDataFocus: null, agentSkillFocus: null, agentScheduleFocus: null, agentFileFocus: { agentId, path } })
    },

    // Where a table card in chat leads. Same contract as openAgentFile: the panel owns its tabs, so
    // this is the transient signal asking it to land on the Database tab, on that table.
    openAgentData: (agentId, table, view) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: null, agentFileFocus: null, agentSkillFocus: null, agentScheduleFocus: null, agentDataFocus: { agentId, table, view } })
    },

    // Where the View of an applied skill proposal leads. The tab still travels through
    // agentFocusRequest, so this only carries which skill the list must drill into.
    openAgentSkill: (agentId, slug) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: { agentId, tab: 'skills' }, agentFileFocus: null, agentDataFocus: null, agentScheduleFocus: null, agentSkillFocus: { agentId, slug } })
    },

    // Same contract as openAgentSkill, for the editor of one routine in the Scheduled tab.
    openAgentSchedule: (agentId, slug) => {
        set({ selectedAgentId: agentId, selectedSpaceId: null, agentFocusRequest: { agentId, tab: 'scheduled' }, agentFileFocus: null, agentDataFocus: null, agentSkillFocus: null, agentScheduleFocus: { agentId, slug } })
    },

    // Un import de template renvoie les ids créés côté serveur, mais les tuiles n'arrivent que par
    // realtime : sélectionner tout de suite ouvrirait le panel sur un agent que le store ne connaît
    // pas encore. On parke l'id et l'insert realtime le consomme.
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

    // Un agent est dessiné à ses propres col/row, pas relativement à sa Box : la déplacer, c'est
    // translater chacun de ses agents posés du même pas. Le navigateur n'a pas de transaction, donc
    // un échec en route réécrit l'ancienne place de tout le monde plutôt que de laisser des agents
    // hors de leur Box.
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
                // Un agent redéplacé entre-temps garde sa nouvelle place.
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
        // Une Box qui naît hors champ n'existe pas pour l'utilisateur : le board se recadre sur ce
        // qu'il contient maintenant. Pas pendant un placement, où il raconte déjà autre chose et où
        // la caméra bougerait sous le curseur.
        const framing = !get().placingAgentId && !get().placement
        // L'espace réel remplace le placeholder d'onboarding : on éteint le loader du premier agent.
        set(state => ({
            spaces: state.spaces.some(s => s.id === space.id) ? state.spaces : [...state.spaces, space],
            startingFirstAgent: false,
            ...(framing ? { recenterSignal: state.recenterSignal + 1 } : {}),
        }))
    },

    _realtimeUpdateSpace: space => {
        if (get()._resizingSpaceId === space.id || get()._movingSpaceId === space.id) return
        // A Box the board never loaded just opened to the caller (back to everyone, for instance):
        // its coworkers and grants are not in this row, the board is read again.
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
            // Un agent qui apparaît (création, ou drop d'un coéquipier) « atterrit » sur la grille.
            ...(isNew ? { justPlacedAgentId: agent.id } : {}),
        }))
        get()._recomputeAgentStatus(agent.id)
        if (get().pendingSelectAgentId === agent.id) {
            set({ pendingSelectAgentId: null })
            get().openAgentChat(agent.id)
        }
        // Retrait du flag après la chute (keyframe 1s) pour que l'animation ne se rejoue pas aux
        // re-renders suivants (changement de statut, sélection…).
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
        // Un changement de statut pendant le déplacement de sa Box porterait encore l'ancienne place.
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

    // Missed realtime events cannot be replayed, so a resync takes the live set as the database has
    // it rather than patching memory: a session opened while the socket was down has to be able to
    // enter, and one that went idle has to leave.
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
            // Le resync tourne à chaque retour d'onglet et rend presque toujours le même ensemble.
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
