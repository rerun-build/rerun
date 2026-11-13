import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FakeSupabase } from '@/test/supabase-fake'

const actions = vi.hoisted(() => ({
    createAgentWithSetupAction: vi.fn(),
    installTemplateAction: vi.fn(),
    installSharedAgentAction: vi.fn(),
    duplicateAgentAction: vi.fn(),
    startKickoffAction: vi.fn(),
}))

vi.mock('@/app/api/_actions/agent.actions', () => ({ deleteAgentAction: vi.fn(), duplicateAgentAction: actions.duplicateAgentAction, moveAgentAction: vi.fn(), renameAgentAction: vi.fn() }))
vi.mock('@/app/api/_actions/chat.actions', () => ({ startKickoffAction: actions.startKickoffAction }))
vi.mock('@/app/api/_actions/services.actions', () => ({ createAgentWithSetupAction: actions.createAgentWithSetupAction }))
vi.mock('@/app/api/_actions/session.actions', () => ({ fetchSessionActiveRun: vi.fn() }))
vi.mock('@/app/api/_actions/space.actions', () => ({ claimSpaceAction: vi.fn(), deleteSpaceAction: vi.fn(), renameSpaceAction: vi.fn() }))
vi.mock('@/app/api/_actions/agent-share.actions', () => ({ installSharedAgentAction: actions.installSharedAgentAction }))
vi.mock('@/app/api/_actions/template.actions', () => ({ installTemplateAction: actions.installTemplateAction }))
vi.mock('@/lib/confetti', () => ({ fireRerunConfetti: vi.fn() }))
vi.mock('@/lib/templates/install-feedback', () => ({ reportDuplicate: vi.fn(), reportInstall: vi.fn(), reportShareInstall: vi.fn() }))
vi.mock('@rerun/analytics/client', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
// The store builds its client once, at import: the fake lives here so a test can read its writes
// and make a table refuse them.
const db = vi.hoisted(() => ({ fake: undefined as unknown as FakeSupabase, refusing: new Set<string>() }))
vi.mock('@/supabase/client', async () => {
    const { fakeSupabase } = await import('@/test/supabase-fake')
    db.fake = fakeSupabase(table => (db.refusing.has(table) ? { error: { message: 'refused' } } : undefined))
    return { createClient: () => db.fake.client }
})

import { UNPLACED_COL } from '@/lib/board/iso'
import type { BoxViewer } from '@/lib/board/box-access'
import type { IsoAgent, SpacePublic } from '@/lib/board/types'
import { toast } from 'sonner'
import { type PlacementQueue, placementLabel, useBoardStore } from './board.store'

const INITIAL = useBoardStore.getState()

const ADMIN: BoxViewer = { userId: 'admin', role: 'admin', boxScope: 'all' }
const MEMBER: BoxViewer = { userId: 'member', role: 'member', boxScope: 'all' }

const space = (id: string, colStart: number, colEnd: number): SpacePublic => ({ id, workspace_id: 7, name: id, col_start: colStart, row_start: 0, col_end: colEnd, row_end: 9, created_at: '' })

const agent = (id: string, spaceId: string, col: number, row: number): IsoAgent => ({ id, name: id, handle: null, description: null, templateId: null, status: 'idle', position: { col, row }, workspaceId: 7, spaceId, disabledAt: null, disabledReason: null })

beforeEach(() => {
    vi.clearAllMocks()
    useBoardStore.setState(INITIAL, true)
    db.refusing.clear()
    db.fake.calls.length = 0
    db.fake.chains.length = 0
})

function beginTemplate(agentNames = ['Scout', 'Writer', 'Closer']) {
    useBoardStore.getState().beginTemplatePlacement({ slug: 'crm-kit', title: 'CRM kit', agentNames })
}

describe('placementLabel', () => {
    const queue = (labels: string[], placed: number): PlacementQueue => ({ source: { kind: 'template', slug: 's', title: 't' }, labels, placed: Array.from({ length: placed }, () => ({ col: 0, row: 0 })), spaceId: null, installing: false })

    it('names the next tile to place', () => {
        expect(placementLabel(queue(['A', 'B'], 0))).toBe('A')
        expect(placementLabel(queue(['A', 'B'], 1))).toBe('B')
    })

    it('keeps the last name once every tile is placed, and is empty without labels', () => {
        expect(placementLabel(queue(['A', 'B'], 2))).toBe('B')
        expect(placementLabel(queue([], 0))).toBe('')
    })
})

describe('pushPlacement', () => {
    it('does nothing without a placement in progress', () => {
        expect(useBoardStore.getState().pushPlacement({ col: 0, row: 0 }, 's1')).toBeNull()
    })

    it('queues each drop and reports done on the last one, locking the queue while it installs', () => {
        beginTemplate(['Scout', 'Writer'])
        const store = useBoardStore.getState()
        expect(store.pushPlacement({ col: 0, row: 0 }, 's1')).toEqual({ positions: [{ col: 0, row: 0 }], done: false })
        expect(store.pushPlacement({ col: 2, row: 0 }, 's1')).toEqual({ positions: [{ col: 0, row: 0 }, { col: 2, row: 0 }], done: true })
        expect(useBoardStore.getState().placement).toMatchObject({ installing: true, spaceId: 's1' })
        expect(store.pushPlacement({ col: 4, row: 0 }, 's1')).toBeNull()
        expect(useBoardStore.getState().placement?.placed).toHaveLength(2)
    })

    it('keeps a template inside the space of its first drop', () => {
        beginTemplate()
        const store = useBoardStore.getState()
        store.pushPlacement({ col: 0, row: 0 }, 's1')
        expect(store.pushPlacement({ col: 20, row: 0 }, 's2')).toBeNull()
        expect(useBoardStore.getState().placement?.placed).toHaveLength(1)
    })

    it('accepts a drop with no space, as on the onboarding placeholder, without losing the locked one', () => {
        beginTemplate()
        const store = useBoardStore.getState()
        store.pushPlacement({ col: 0, row: 0 }, 's1')
        expect(store.pushPlacement({ col: 2, row: 0 }, null)).toMatchObject({ done: false })
        expect(useBoardStore.getState().placement?.spaceId).toBe('s1')
    })

    it('is done on the first drop of a single agent', () => {
        useBoardStore.getState().beginAgentPlacement({ name: 'Scout', serviceSlugs: [] })
        expect(useBoardStore.getState().pushPlacement({ col: 0, row: 0 }, null)).toMatchObject({ done: true })
    })
})

describe('beginning a placement', () => {
    it('clears the selection and names a duplicate as a copy', () => {
        useBoardStore.setState({ selectedAgentId: 'a1', selectedSpaceId: 's1' })
        useBoardStore.getState().beginAgentDuplicatePlacement({ agentId: 'a1', agentName: 'Scout' })
        const state = useBoardStore.getState()
        expect(state).toMatchObject({ selectedAgentId: null, selectedSpaceId: null })
        expect(state.placement?.labels).toHaveLength(1)
        expect(state.placement?.labels[0]).not.toBe('Scout')
    })
})

describe('confirmPlacement', () => {
    it('ignores a drop outside every space', () => {
        useBoardStore.setState({ spaces: [space('s1', 0, 9)] })
        beginTemplate(['Scout'])
        useBoardStore.getState().confirmPlacement({ col: 30, row: 0 }, ADMIN)
        expect(useBoardStore.getState().placement?.placed).toEqual([])
    })

    it('installs the template in the space under the last tile, then clears the queue', async () => {
        actions.installTemplateAction.mockResolvedValue({ ok: true, imported: 2, failed: [], agentIds: [] })
        useBoardStore.setState({ spaces: [space('s1', 0, 9), space('s2', 10, 19)] })
        beginTemplate(['Scout', 'Writer'])
        useBoardStore.getState().confirmPlacement({ col: 0, row: 0 }, ADMIN)
        expect(actions.installTemplateAction).not.toHaveBeenCalled()
        useBoardStore.getState().confirmPlacement({ col: 3, row: 0 }, ADMIN)
        await vi.waitFor(() => expect(useBoardStore.getState().placement).toBeNull())
        expect(actions.installTemplateAction).toHaveBeenCalledWith({ slug: 'crm-kit', spaceId: 's1', positions: [{ col: 0, row: 0 }, { col: 3, row: 0 }] })
    })

    it('creates a described agent with its apps in the space under the tile', async () => {
        actions.createAgentWithSetupAction.mockResolvedValue({ ok: true, agentId: 'a1', active: true, checklist: [] })
        useBoardStore.setState({ spaces: [space('s1', 0, 9)] })
        useBoardStore.getState().beginAgentPlacement({ name: 'Reply Sorter', serviceSlugs: ['lemlist', 'slack'], kickoff: 'Sort every Lemlist reply' })
        useBoardStore.getState().confirmPlacement({ col: 2, row: 1 }, ADMIN)
        await vi.waitFor(() => expect(useBoardStore.getState().placement).toBeNull())
        expect(actions.createAgentWithSetupAction).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reply Sorter', serviceSlugs: ['lemlist', 'slack'], spaceId: 's1', col: 2, row: 1 }))
        expect(useBoardStore.getState().selectedAgentId).toBe('a1')
    })

    it('clears the queue even when the install throws', async () => {
        actions.installTemplateAction.mockRejectedValue(new Error('timeout'))
        useBoardStore.setState({ spaces: [space('s1', 0, 9)] })
        beginTemplate(['Scout'])
        useBoardStore.getState().confirmPlacement({ col: 0, row: 0 }, ADMIN)
        await vi.waitFor(() => expect(useBoardStore.getState().placement).toBeNull())
    })
})

describe('cancelPlacement', () => {
    it('throws the whole queue away, nothing having been created', () => {
        beginTemplate()
        useBoardStore.getState().pushPlacement({ col: 0, row: 0 }, 's1')
        useBoardStore.getState().cancelPlacement()
        expect(useBoardStore.getState().placement).toBeNull()
        expect(actions.installTemplateAction).not.toHaveBeenCalled()
    })
})

describe('moveSpace', () => {
    const MOVED = { col_start: 0, row_start: 20, col_end: 7, row_end: 29 }

    beforeEach(() => {
        useBoardStore.setState({
            spaces: [space('s1', 0, 7), space('s2', 9, 16)],
            agents: [agent('carried', 's1', 1, 1), agent('unplaced', 's1', UNPLACED_COL, 0), agent('neighbour', 's2', 10, 1)],
        })
    })

    const positionOf = (id: string) => useBoardStore.getState().agents.find(a => a.id === id)?.position
    const settled = () => vi.waitFor(() => expect(useBoardStore.getState()._movingSpaceId).toBeNull())

    it('carries the placed agents of the Box by the same step, and writes each of them', async () => {
        useBoardStore.getState().moveSpace('s1', MOVED, ADMIN)

        expect(useBoardStore.getState().spaces.find(s => s.id === 's1')).toMatchObject(MOVED)
        expect(positionOf('carried')).toEqual({ col: 1, row: 21 })
        expect(positionOf('unplaced')).toEqual({ col: UNPLACED_COL, row: 0 })
        expect(positionOf('neighbour')).toEqual({ col: 10, row: 1 })

        await settled()
        expect(db.fake.writes('spaces').map(w => w.payload)).toEqual([MOVED])
        expect(db.fake.writes('agents').map(w => w.payload)).toEqual([{ col: 1, row: 21 }])
        expect(toast.error).not.toHaveBeenCalled()
    })

    it('puts the Box and its agents back, on screen and in the database, when a write is refused', async () => {
        db.refusing.add('agents')
        useBoardStore.getState().moveSpace('s1', MOVED, ADMIN)
        await settled()

        expect(useBoardStore.getState().spaces.find(s => s.id === 's1')).toMatchObject({ col_start: 0, row_start: 0, col_end: 7, row_end: 9 })
        expect(positionOf('carried')).toEqual({ col: 1, row: 1 })
        expect(db.fake.writes('spaces').map(w => w.payload)).toEqual([MOVED, { col_start: 0, row_start: 0, col_end: 7, row_end: 9 }])
        expect(db.fake.writes('agents').map(w => w.payload)).toEqual([{ col: 1, row: 21 }, { col: 1, row: 1 }])
        expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ props: { id: 'builder.boardToasts.moveBoxFailed' } }), expect.anything())
    })

    it('keeps a carried agent where it was dropped when a realtime update still holds its old place', async () => {
        useBoardStore.getState().moveSpace('s1', MOVED, ADMIN)
        useBoardStore.getState()._onAgentUpdate(agent('carried', 's1', 1, 1))
        useBoardStore.getState()._realtimeUpdateSpace(space('s1', 0, 7))

        expect(positionOf('carried')).toEqual({ col: 1, row: 21 })
        expect(useBoardStore.getState().spaces.find(s => s.id === 's1')).toMatchObject(MOVED)
        await settled()
    })
})

describe('the board writes for a member who only uses the Box', () => {
    const REASON = 'Only an admin or a manager of this Box can do this'

    beforeEach(() => {
        useBoardStore.setState({
            spaces: [space('used', 0, 7), space('managed', 9, 16)],
            agents: [agent('scout', 'used', 1, 1), agent('writer', 'managed', 10, 1)],
            spaceGrants: [{ space_id: 'managed', user_id: 'member', access: 'manage' }],
        })
    })

    const positionOf = (id: string) => useBoardStore.getState().agents.find(a => a.id === id)?.position

    it('does not move a coworker out of a Box they only use, nor write it', () => {
        useBoardStore.getState().moveAgent('scout', { col: 3, row: 3 }, 'used', MEMBER)
        useBoardStore.getState().moveAgent('scout', { col: 11, row: 4 }, 'managed', MEMBER)
        expect(positionOf('scout')).toEqual({ col: 1, row: 1 })
        expect(db.fake.writes('agents')).toEqual([])
        expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ props: { refusal: { error: REASON, code: 'boxManagerOnly' } } }), expect.anything())
    })

    it('does not drop a coworker in a Box they only use', () => {
        useBoardStore.getState().moveAgent('writer', { col: 3, row: 3 }, 'used', MEMBER)
        expect(useBoardStore.getState().agents.find(a => a.id === 'writer')).toMatchObject({ spaceId: 'managed', position: { col: 10, row: 1 } })
        expect(db.fake.writes('agents')).toEqual([])
    })

    it('moves a coworker inside a Box they manage', () => {
        useBoardStore.getState().moveAgent('writer', { col: 12, row: 3 }, 'managed', MEMBER)
        expect(positionOf('writer')).toEqual({ col: 12, row: 3 })
        expect(db.fake.writes('agents').map(w => w.payload)).toEqual([{ col: 12, row: 3, space_id: 'managed' }])
    })

    it('does not resize, move, rename or delete a Box they only use', async () => {
        const { renameSpaceAction, deleteSpaceAction } = await import('@/app/api/_actions/space.actions')
        const store = useBoardStore.getState()
        store.updateSpace('used', { col_end: 9 }, MEMBER)
        store.moveSpace('used', { col_start: 0, row_start: 20, col_end: 7, row_end: 29 }, MEMBER)
        store.renameSpace('used', 'Mine now', MEMBER)
        store.deleteSpace('used', MEMBER)

        expect(useBoardStore.getState().spaces.find(s => s.id === 'used')).toMatchObject({ col_start: 0, row_start: 0, col_end: 7, row_end: 9 })
        expect(db.fake.writes('spaces')).toEqual([])
        expect(db.fake.writes('agents')).toEqual([])
        expect(renameSpaceAction).not.toHaveBeenCalled()
        expect(deleteSpaceAction).not.toHaveBeenCalled()
    })

    it('does not send a coworker to a Box they only use from the menu', async () => {
        const { moveAgentAction } = await import('@/app/api/_actions/agent.actions')
        useBoardStore.getState().moveAgentToBox('writer', 'used', MEMBER)
        useBoardStore.getState().moveAgentToBox('scout', 'managed', MEMBER)
        expect(moveAgentAction).not.toHaveBeenCalled()
    })

    it('places a new coworker only in a Box they manage', async () => {
        actions.createAgentWithSetupAction.mockResolvedValue({ ok: true, agentId: 'a1', active: true, checklist: [] })
        useBoardStore.getState().beginAgentPlacement({ name: 'Scout', serviceSlugs: [] })
        useBoardStore.getState().confirmPlacement({ col: 3, row: 3 }, MEMBER)
        expect(useBoardStore.getState().placement?.placed).toEqual([])
        expect(actions.createAgentWithSetupAction).not.toHaveBeenCalled()

        useBoardStore.getState().confirmPlacement({ col: 12, row: 4 }, MEMBER)
        await vi.waitFor(() => expect(useBoardStore.getState().placement).toBeNull())
        expect(actions.createAgentWithSetupAction).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'managed' }))
    })

    it('lets an admin write every Box', () => {
        useBoardStore.getState().updateSpace('used', { col_end: 8 }, ADMIN)
        expect(db.fake.writes('spaces').map(w => w.payload)).toEqual([{ col_end: 8 }])
    })
})

describe('a Box the board never loaded', () => {
    it('reads the board again when an unknown Box is updated, then reframes', async () => {
        const hydrate = vi.fn().mockResolvedValue(undefined)
        useBoardStore.setState({ spaces: [space('s1', 0, 7)], hydrate, recenterSignal: 3 })
        useBoardStore.getState()._realtimeUpdateSpace({ ...space('opened', 9, 16), workspace_id: 7 })
        expect(hydrate).toHaveBeenCalledWith(7)
        await vi.waitFor(() => expect(useBoardStore.getState().recenterSignal).toBe(4))
        expect(useBoardStore.getState().spaces.map(s => s.id)).toEqual(['s1'])
    })

    it('does not reframe under a placement in progress', async () => {
        const hydrate = vi.fn().mockResolvedValue(undefined)
        useBoardStore.setState({ spaces: [], hydrate, recenterSignal: 3 })
        beginTemplate(['Scout'])
        useBoardStore.getState()._realtimeUpdateSpace(space('opened', 9, 16))
        await vi.waitFor(() => expect(hydrate).toHaveBeenCalled())
        await Promise.resolve()
        expect(useBoardStore.getState().recenterSignal).toBe(3)
    })

    it('updates a known Box in place without reading the board again', () => {
        const hydrate = vi.fn()
        useBoardStore.setState({ spaces: [space('s1', 0, 7)], hydrate })
        useBoardStore.getState()._realtimeUpdateSpace({ ...space('s1', 0, 7), name: 'Renamed' })
        expect(hydrate).not.toHaveBeenCalled()
        expect(useBoardStore.getState().spaces[0]).toMatchObject({ name: 'Renamed' })
    })
})

describe('claimSpace', () => {
    it('writes the creator grant of a member before realtime brings it', async () => {
        const { claimSpaceAction } = await import('@/app/api/_actions/space.actions')
        vi.mocked(claimSpaceAction).mockResolvedValue({ ok: true, spaceId: 'mine', colStart: 0, rowStart: 0 })
        useBoardStore.setState({ spaceGrants: [{ space_id: 'other', user_id: 'member', access: 'use' }] })
        await useBoardStore.getState().claimSpace(7, 'Mine', undefined, MEMBER)
        expect(useBoardStore.getState().spaceGrants).toEqual([
            { space_id: 'other', user_id: 'member', access: 'use' },
            { space_id: 'mine', user_id: 'member', access: 'manage' },
        ])
    })

    it('writes nothing for an admin, who manages every Box already', async () => {
        const { claimSpaceAction } = await import('@/app/api/_actions/space.actions')
        vi.mocked(claimSpaceAction).mockResolvedValue({ ok: true, spaceId: 'mine', colStart: 0, rowStart: 0 })
        await useBoardStore.getState().claimSpace(7, 'Mine', undefined, ADMIN)
        expect(useBoardStore.getState().spaceGrants).toEqual([])
    })

    it('throws the refusal and writes no grant', async () => {
        const { claimSpaceAction } = await import('@/app/api/_actions/space.actions')
        vi.mocked(claimSpaceAction).mockResolvedValue({ ok: false, error: 'No room' })
        await expect(useBoardStore.getState().claimSpace(7, 'Mine', undefined, MEMBER)).rejects.toThrow('No room')
        expect(useBoardStore.getState().spaceGrants).toEqual([])
    })
})

describe('dropSpaces', () => {
    it('drops the Box with its coworkers and closes the panel open on one of them', () => {
        useBoardStore.setState({ spaces: [space('gone', 0, 7), space('kept', 9, 16)], agents: [agent('scout', 'gone', 1, 1), agent('writer', 'kept', 10, 1)], selectedAgentId: 'scout' })
        expect(useBoardStore.getState().dropSpaces(['gone'])).toBe(true)
        expect(useBoardStore.getState()).toMatchObject({ selectedAgentId: null })
        expect(useBoardStore.getState().spaces.map(s => s.id)).toEqual(['kept'])
        expect(useBoardStore.getState().agents.map(a => a.id)).toEqual(['writer'])
    })

    it('answers false for a Box the board does not hold', () => {
        useBoardStore.setState({ spaces: [space('kept', 9, 16)] })
        expect(useBoardStore.getState().dropSpaces(['unknown'])).toBe(false)
    })
})

describe('kickoff of a coworker created right after another one', () => {
    const storage = new Map<string, string>()
    type Kickoff = { ok: true; sessionId: string; runId: string } | { ok: false; error: string; agentGone: boolean }

    beforeEach(() => {
        storage.clear()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => void storage.set(key, value),
            removeItem: (key: string) => void storage.delete(key),
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const flush = () => new Promise(resolve => setTimeout(resolve, 0))

    function deferredKickoffs() {
        const answers = new Map<string, (result: Kickoff) => void>()
        actions.startKickoffAction.mockImplementation((agentId: string) => new Promise<Kickoff>(resolve => answers.set(agentId, resolve)))
        return (agentId: string, result: Kickoff) => answers.get(agentId)!(result)
    }

    function openedSessions() {
        const opened: unknown[] = []
        useBoardStore.subscribe((state, previous) => {
            if (state.pendingOpenSession && state.pendingOpenSession !== previous.pendingOpenSession) opened.push(state.pendingOpenSession)
        })
        return opened
    }

    it('sends each kickoff and opens each panel on its own conversation', async () => {
        const answer = deferredKickoffs()
        const opened = openedSessions()

        useBoardStore.getState().finalizeAgentCreation('gig', undefined, 'You are Gig Applier')
        useBoardStore.getState().finalizeAgentCreation('tracker', undefined, 'You are Tracker')
        answer('gig', { ok: true, sessionId: 'gig-session', runId: 'gig-run' })
        answer('tracker', { ok: true, sessionId: 'tracker-session', runId: 'tracker-run' })
        await flush()

        expect(actions.startKickoffAction.mock.calls).toEqual([
            ['gig', { kickoff: 'You are Gig Applier', description: undefined }],
            ['tracker', { kickoff: 'You are Tracker', description: undefined }],
        ])
        expect(opened).toEqual([
            { agentId: 'gig', sessionId: 'gig-session', runId: 'gig-run' },
            { agentId: 'tracker', sessionId: 'tracker-session', runId: 'tracker-run' },
        ])
        expect(storage.get('rerun:pending-kickoffs')).toBeUndefined()
    })

    it('sends a kickoff once when the wizard and the boot replay ask for it together', async () => {
        const answer = deferredKickoffs()
        useBoardStore.getState().finalizeAgentCreation('gig', undefined, 'You are Gig Applier')
        const replay = useBoardStore.getState().sendPendingKickoff()
        answer('gig', { ok: true, sessionId: 'gig-session', runId: 'gig-run' })

        expect(await replay).toEqual({ agentId: 'gig', sessionId: 'gig-session' })
        expect(actions.startKickoffAction).toHaveBeenCalledTimes(1)
    })

    it('replays at boot every kickoff still parked, and keeps the one that failed on a transient error', async () => {
        storage.set('rerun:pending-kickoffs', JSON.stringify({ gig: { kickoff: 'Gig brief' }, tracker: { kickoff: 'Tracker brief' } }))
        const answer = deferredKickoffs()
        const replay = useBoardStore.getState().sendPendingKickoff()
        answer('gig', { ok: false, error: 'engine unreachable', agentGone: false })
        answer('tracker', { ok: true, sessionId: 'tracker-session', runId: 'tracker-run' })

        expect(await replay).toEqual({ agentId: 'tracker', sessionId: 'tracker-session' })
        expect(JSON.parse(storage.get('rerun:pending-kickoffs')!)).toEqual({ gig: { kickoff: 'Gig brief' } })
        expect(useBoardStore.getState().pendingOpenSession).toEqual({ agentId: 'tracker', sessionId: 'tracker-session', runId: 'tracker-run' })
    })

    it('opens at boot the conversation of the coworker it selects, whichever kickoff answers last', async () => {
        storage.set('rerun:pending-kickoffs', JSON.stringify({ gig: { kickoff: 'Gig brief' }, tracker: { kickoff: 'Tracker brief' } }))
        const answer = deferredKickoffs()
        const replay = useBoardStore.getState().sendPendingKickoff()
        answer('tracker', { ok: true, sessionId: 'tracker-session', runId: 'tracker-run' })
        answer('gig', { ok: true, sessionId: 'gig-session', runId: 'gig-run' })

        const selected = await replay
        expect(selected).toEqual({ agentId: 'tracker', sessionId: 'tracker-session' })
        expect(useBoardStore.getState().pendingOpenSession).toEqual({ agentId: 'tracker', sessionId: 'tracker-session', runId: 'tracker-run' })
    })
})

describe('requestCreation', () => {
    const scratch = { kind: 'scratch' as const, draft: { name: 'Scout', serviceSlugs: ['slack'], kickoff: 'Find leads' } }

    it('queues a placement on the grid in the 3D view, creating nothing yet', () => {
        useBoardStore.setState({ spaces: [space('s1', 0, 9)] })
        useBoardStore.getState().requestCreation(scratch, ADMIN)
        expect(useBoardStore.getState().placement).toMatchObject({ source: { kind: 'scratch' }, labels: ['Scout'] })
        expect(actions.createAgentWithSetupAction).not.toHaveBeenCalled()
    })

    describe('in the Simple view', () => {
        beforeEach(() => useBoardStore.getState().setCreationFrame('list'))

        it('creates straight into the only Box, the server choosing the spot, and opens the coworker', async () => {
            actions.createAgentWithSetupAction.mockResolvedValue({ ok: true, agentId: 'a1', active: true, checklist: [] })
            useBoardStore.setState({ spaces: [space('s1', 0, 9)] })
            useBoardStore.getState().requestCreation(scratch, ADMIN)
            await vi.waitFor(() => expect(useBoardStore.getState().selectedAgentId).toBe('a1'))
            expect(actions.createAgentWithSetupAction).toHaveBeenCalledWith(expect.objectContaining({ name: 'Scout', spaceId: 's1', col: undefined, row: undefined }))
            expect(useBoardStore.getState().placement).toBeNull()
        })

        it('asks which Box when there are several, and creates in the one picked', async () => {
            actions.installTemplateAction.mockResolvedValue({ ok: true, imported: 2, failed: [], agentIds: [] })
            useBoardStore.setState({ spaces: [space('s1', 0, 9), space('s2', 10, 19)] })
            const template = { kind: 'template' as const, slug: 'crm-kit', title: 'CRM kit', agentNames: ['Scout', 'Writer'] }
            useBoardStore.getState().requestCreation(template, ADMIN)
            expect(useBoardStore.getState().boxChoice).toEqual(template)
            expect(actions.installTemplateAction).not.toHaveBeenCalled()

            useBoardStore.getState().chooseBox('s2', ADMIN)
            expect(useBoardStore.getState().boxChoice).toBeNull()
            await vi.waitFor(() => expect(actions.installTemplateAction).toHaveBeenCalledWith({ slug: 'crm-kit', spaceId: 's2', positions: undefined, again: undefined }))
        })

        it('creates nothing when the choice is dismissed', () => {
            useBoardStore.setState({ spaces: [space('s1', 0, 9), space('s2', 10, 19)] })
            useBoardStore.getState().requestCreation(scratch, ADMIN)
            useBoardStore.getState().chooseBox(null, ADMIN)
            expect(useBoardStore.getState().boxChoice).toBeNull()
            expect(actions.createAgentWithSetupAction).not.toHaveBeenCalled()
        })

        it('sends a coworker asked from a Box to it, and a copy to its original\'s Box', async () => {
            actions.createAgentWithSetupAction.mockResolvedValue({ ok: true, agentId: 'a1', active: true, checklist: [] })
            actions.duplicateAgentAction.mockResolvedValue({ ok: true, agentId: 'a2', agentName: 'Scout (copy)', inactive: false, schedules: [], triggers: [] })
            useBoardStore.setState({ spaces: [space('s1', 0, 9), space('s2', 10, 19)] })
            useBoardStore.getState().requestCreation({ ...scratch, spaceId: 's2' }, ADMIN)
            useBoardStore.getState().requestCreation({ kind: 'duplicate', agentId: 'scout', agentName: 'Scout', spaceId: 's1' }, ADMIN)
            expect(useBoardStore.getState().boxChoice).toBeNull()
            await vi.waitFor(() => expect(actions.duplicateAgentAction).toHaveBeenCalledWith({ agentId: 'scout', spaceId: 's1', position: undefined }))
            expect(actions.createAgentWithSetupAction).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 's2' }))
        })

        it('counts only the Boxes a member manages, and refuses when there is none', async () => {
            actions.installSharedAgentAction.mockResolvedValue({ ok: true, agentId: 'a3', inactive: false })
            useBoardStore.setState({ spaces: [space('used', 0, 7), space('managed', 9, 16)], spaceGrants: [{ space_id: 'managed', user_id: 'member', access: 'manage' }] })
            useBoardStore.getState().requestCreation({ kind: 'share', token: 'tok', agentName: 'Scout' }, MEMBER)
            await vi.waitFor(() => expect(actions.installSharedAgentAction).toHaveBeenCalledWith({ token: 'tok', spaceId: 'managed', position: undefined }))

            useBoardStore.setState({ spaceGrants: [] })
            useBoardStore.getState().requestCreation({ kind: 'share', token: 'tok', agentName: 'Scout' }, { ...MEMBER, boxScope: 'assigned' })
            expect(toast.error).toHaveBeenCalled()
            expect(actions.installSharedAgentAction).toHaveBeenCalledTimes(1)
        })

        it('refuses a Box the caller only uses, even when asked for it', () => {
            useBoardStore.setState({ spaces: [space('used', 0, 7)] })
            useBoardStore.getState().requestCreation({ ...scratch, spaceId: 'used' }, MEMBER)
            expect(actions.createAgentWithSetupAction).not.toHaveBeenCalled()
        })
    })
})
