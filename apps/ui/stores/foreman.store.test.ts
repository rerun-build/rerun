import { beforeEach, describe, expect, it, vi } from 'vitest'

const board = vi.hoisted(() => ({ selectAgent: vi.fn(), selectSpace: vi.fn() }))

vi.mock('@/stores/board.store', () => ({ useBoardStore: { getState: () => board } }))
vi.mock('@/lib/foreman-open', () => ({ rememberForemanOpen: vi.fn() }))
vi.mock('@/lib/foreman-layout', () => ({ rememberForemanPlacement: vi.fn() }))

import { rememberForemanPlacement } from '@/lib/foreman-layout'
import type { ForemanPlacement } from '@/lib/foreman-layout'
import { rememberForemanOpen } from '@/lib/foreman-open'
import { foremanOrbState, selectForemanBackend, selectForemanOpen, selectForemanVisible, useForemanStore } from './foreman.store'

const INITIAL = useForemanStore.getState()
const DOCK: ForemanPlacement = { mode: 'dock', side: 'right', width: 400, height: 600, dockWidth: 400 }
const FLOAT: ForemanPlacement = { mode: 'float', corner: 'top-left', width: 400, height: 600, dockWidth: 400 }

beforeEach(() => {
    vi.clearAllMocks()
    useForemanStore.setState(INITIAL, true)
})

describe('restoreOpen / restorePlacement', () => {
    it('fill the value only while the client has not decided yet', () => {
        const store = useForemanStore.getState()
        store.restoreOpen(false)
        store.restoreOpen(true)
        store.restorePlacement(DOCK)
        store.restorePlacement(FLOAT)
        expect(useForemanStore.getState()).toMatchObject({ open: false, placement: DOCK })
    })

    it('leave a value set by a gesture alone and never remember anything', () => {
        useForemanStore.getState().openForFunnel()
        useForemanStore.getState().setPlacement(FLOAT)
        vi.mocked(rememberForemanPlacement).mockClear()
        useForemanStore.getState().restoreOpen(false)
        useForemanStore.getState().restorePlacement(DOCK)
        expect(useForemanStore.getState()).toMatchObject({ open: true, placement: FLOAT })
        expect(rememberForemanOpen).not.toHaveBeenCalled()
        expect(rememberForemanPlacement).not.toHaveBeenCalled()
    })
})

describe('opening', () => {
    it('toggles from undecided to open, clears the board selection and remembers it', () => {
        useForemanStore.getState().toggle()
        expect(useForemanStore.getState().open).toBe(true)
        expect(board.selectAgent).toHaveBeenCalledWith(null)
        expect(board.selectSpace).toHaveBeenCalledWith(null)
        expect(rememberForemanOpen).toHaveBeenLastCalledWith(true)
        useForemanStore.getState().toggle()
        expect(useForemanStore.getState().open).toBe(false)
        expect(rememberForemanOpen).toHaveBeenLastCalledWith(false)
    })

    it('opens for the funnel without turning it into a preference', () => {
        useForemanStore.getState().openForFunnel()
        expect(useForemanStore.getState().open).toBe(true)
        expect(rememberForemanOpen).not.toHaveBeenCalled()
    })

    it('starts the funnel with its intake card in one go', () => {
        useForemanStore.getState().startFunnel(true)
        expect(useForemanStore.getState()).toMatchObject({ funnel: 'guided', intake: true, open: true })
    })

    it('opens and parks a prompt when asked from outside the column', () => {
        useForemanStore.getState().askForeman('Set up my CRM')
        expect(useForemanStore.getState()).toMatchObject({ open: true, pendingPrompt: 'Set up my CRM' })
        expect(rememberForemanOpen).toHaveBeenCalledWith(true)
    })
})

describe('yielding to a sheet', () => {
    it('steps aside without remembering it, and comes back when the sheet closes', () => {
        useForemanStore.setState({ open: true })
        useForemanStore.getState().yieldToSheet()
        expect(useForemanStore.getState()).toMatchObject({ open: false, yieldedToSheet: true })
        useForemanStore.getState().reclaimFromSheet()
        expect(useForemanStore.getState()).toMatchObject({ open: true, yieldedToSheet: false })
        expect(rememberForemanOpen).not.toHaveBeenCalled()
    })

    it('does not reopen a column that never stepped aside', () => {
        useForemanStore.setState({ open: false })
        useForemanStore.getState().reclaimFromSheet()
        expect(useForemanStore.getState().open).toBe(false)
    })

    it('stays closed once closed by hand while stepped aside', () => {
        useForemanStore.setState({ open: true })
        useForemanStore.getState().yieldToSheet()
        useForemanStore.getState().close()
        useForemanStore.getState().reclaimFromSheet()
        expect(useForemanStore.getState().open).toBe(false)
    })

    it('forgets the step aside when the orb reopens the column', () => {
        useForemanStore.setState({ open: true })
        useForemanStore.getState().yieldToSheet()
        useForemanStore.getState().toggle()
        expect(useForemanStore.getState()).toMatchObject({ open: true, yieldedToSheet: false })
    })
})

describe('backend', () => {
    it('talks to the hub through the onboarding and to the engine past it', () => {
        const store = useForemanStore.getState()
        store.setSurface('onboarding')
        expect(selectForemanBackend(useForemanStore.getState())).toBe('hub')
        store.setSurface('engine')
        expect(selectForemanBackend(useForemanStore.getState())).toBe('engine')
    })

    it('keeps a pinned conversation where it started when the surface moves', () => {
        const store = useForemanStore.getState()
        store.setSurface('onboarding')
        store.pinBackend()
        store.setSurface('engine')
        expect(selectForemanBackend(useForemanStore.getState())).toBe('hub')
        store.newChat()
        expect(selectForemanBackend(useForemanStore.getState())).toBe('engine')
    })

    it('hides the foreman only once the server said there is no machine', () => {
        expect(selectForemanVisible(useForemanStore.getState())).toBe(true)
        useForemanStore.getState().setSurface('none')
        expect(selectForemanVisible(useForemanStore.getState())).toBe(false)
    })

    it('starts a new chat unpinned, on a fresh session, without the previews', () => {
        const store = useForemanStore.getState()
        const before = useForemanStore.getState().sessionId
        store.pinBackend()
        store.setPlanPreview({} as never)
        store.newChat()
        expect(useForemanStore.getState()).toMatchObject({ backend: null, planPreview: null, intakePreview: null, intake: false })
        expect(useForemanStore.getState().sessionId).not.toBe(before)
    })
})

describe('reset', () => {
    it('forgets the visitor\'s conversation but keeps the screen preferences', () => {
        const store = useForemanStore.getState()
        store.restoreOpen(true)
        store.restorePlacement(DOCK)
        store.startFunnel(true)
        store.askForeman('hi')
        store.reset()
        expect(useForemanStore.getState()).toMatchObject({ open: true, placement: DOCK, funnel: 'unknown', intake: false, pendingPrompt: null, accountSwitches: 1 })
    })
})

describe('selectors', () => {
    it('reads an undecided column as closed', () => {
        expect(selectForemanOpen(useForemanStore.getState())).toBe(false)
    })

    it('lets work in progress win over the open state of the orb', () => {
        expect(foremanOrbState({ open: true, activity: 'idle' })).toBe('listening')
        expect(foremanOrbState({ open: false, activity: 'idle' })).toBe('idle')
        expect(foremanOrbState({ open: false, activity: 'thinking' as never })).toBe('thinking')
    })
})
