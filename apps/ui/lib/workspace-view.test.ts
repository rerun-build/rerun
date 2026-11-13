import { afterEach, describe, expect, it, vi } from 'vitest'

import { FOREMAN_OPENED, initialOpenOf, loadGrouping, loadPins, loadWorkspaceView, parseWorkspaceView, rememberWorkspaceView, resolveWorkspaceView, saveGrouping, savePins, togglePin, WORKSPACE_VIEW_COOKIE, WORKSPACE_VIEW_STORAGE_KEY, type WorkspaceViewContext } from './workspace-view'

function stubBrowser(stored?: string) {
    const storage = new Map<string, string>(stored === undefined ? [] : [[WORKSPACE_VIEW_STORAGE_KEY, stored]])
    const written: string[] = []
    vi.stubGlobal('window', { location: { protocol: 'https:' } })
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
    })
    vi.stubGlobal('document', {
        set cookie(value: string) {
            written.push(value)
        },
    })
    return { storage, written }
}

afterEach(() => vi.unstubAllGlobals())

const ready: WorkspaceViewContext = { enabled: true, preference: 'simple', anonymous: false, onboarding: false, waitlisted: false, placing: false, boxless: false }

describe('workspace view preference', () => {
    it('reads the two views it writes, and nothing else', () => {
        expect(parseWorkspaceView('board')).toBe('board')
        expect(parseWorkspaceView('simple')).toBe('simple')
        expect(parseWorkspaceView('3d')).toBeNull()
        expect(parseWorkspaceView(undefined)).toBeNull()
    })

    it('loads what this browser chose, nothing when it never chose', () => {
        stubBrowser('simple')
        expect(loadWorkspaceView()).toBe('simple')
        stubBrowser()
        expect(loadWorkspaceView()).toBeNull()
    })

    it('writes the choice to the browser and mirrors it in a cookie the server reads', () => {
        const { storage, written } = stubBrowser()
        rememberWorkspaceView('simple')
        expect(storage.get(WORKSPACE_VIEW_STORAGE_KEY)).toBe('simple')
        expect(written[0]).toContain(`${WORKSPACE_VIEW_COOKIE}=simple`)
        expect(written[0]).toContain('path=/')
        expect(written[0]).toContain('Secure')
    })

    it('survives a browser that refuses its storage', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('denied')
            },
        })
        expect(loadWorkspaceView()).toBeNull()
    })
})

describe('resolveWorkspaceView', () => {
    it('follows the preference once nothing needs the grid', () => {
        expect(resolveWorkspaceView(ready)).toBe('simple')
        expect(resolveWorkspaceView({ ...ready, preference: 'board' })).toBe('board')
    })

    it('stays on the board for an account the view is not released to, whatever it chose', () => {
        expect(resolveWorkspaceView({ ...ready, enabled: false })).toBe('board')
    })

    it('stays on the board by default', () => {
        expect(resolveWorkspaceView({ ...ready, preference: null })).toBe('board')
    })

    it('hands the screen to the board while the grid is needed, then gives it back', () => {
        for (const need of ['anonymous', 'onboarding', 'waitlisted', 'placing', 'boxless'] as const) {
            expect(resolveWorkspaceView({ ...ready, [need]: true })).toBe('board')
        }
        expect(resolveWorkspaceView({ ...ready, placing: false })).toBe('simple')
    })
})

describe("the phone list's pins and grouping", () => {
    it('keeps the pins of each workspace apart, in the order they were pinned', () => {
        stubBrowser()
        savePins(7, togglePin(togglePin([], 'b'), 'a'))
        savePins(8, ['z'])
        expect(loadPins(7)).toEqual(['b', 'a'])
        expect(loadPins(8)).toEqual(['z'])
        expect(togglePin(['b', 'a'], 'b')).toEqual(['a'])
    })

    it('reads no pins from nothing or from something that is not a list of ids', () => {
        const { storage } = stubBrowser()
        expect(loadPins(7)).toEqual([])
        storage.set('rerun:simple-pins:7', '{"a":1}')
        expect(loadPins(7)).toEqual([])
        storage.set('rerun:simple-pins:7', '["a",3,"b"]')
        expect(loadPins(7)).toEqual(['a', 'b'])
        storage.set('rerun:simple-pins:7', 'not json')
        expect(loadPins(7)).toEqual([])
    })

    it('lists by recency until the person picks the Boxes', () => {
        stubBrowser()
        expect(loadGrouping(7)).toBe('recent')
        saveGrouping(7, 'box')
        expect(loadGrouping(7)).toBe('box')
        expect(loadGrouping(8)).toBe('recent')
    })
})

describe('initialOpenOf', () => {
    const workspace = { agentIds: ['scout', 'writer'], foremanVisible: true, mostRecent: 'writer' }

    it('opens the coworker open last on this device', () => {
        expect(initialOpenOf({ ...workspace, remembered: 'scout' })).toEqual({ kind: 'coworker', agentId: 'scout' })
    })

    it('opens the Chief of Staff when it was open last, when nothing was, or when the coworker is gone', () => {
        expect(initialOpenOf({ ...workspace, remembered: FOREMAN_OPENED })).toEqual({ kind: 'foreman' })
        expect(initialOpenOf({ ...workspace, remembered: null })).toEqual({ kind: 'foreman' })
        expect(initialOpenOf({ ...workspace, remembered: 'deleted' })).toEqual({ kind: 'foreman' })
    })

    it('opens the most recently active coworker in a workspace without a Chief of Staff', () => {
        expect(initialOpenOf({ ...workspace, foremanVisible: false, remembered: null })).toEqual({ kind: 'coworker', agentId: 'writer' })
        expect(initialOpenOf({ ...workspace, foremanVisible: false, remembered: FOREMAN_OPENED })).toEqual({ kind: 'coworker', agentId: 'writer' })
        expect(initialOpenOf({ agentIds: [], foremanVisible: false, mostRecent: null, remembered: null })).toBeNull()
    })
})
