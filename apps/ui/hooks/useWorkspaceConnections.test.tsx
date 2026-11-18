// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoxBackupModels, BoxConnection } from '@/lib/engine/types'

// The list is refetched at the end of every run so the rings of the model pill follow the plan. A
// refetch the engine cannot answer, right as it goes away, used to land as an empty list: every
// picker read "Set up a model" and the composer locked until the providers dialog was opened.

const mocks = vi.hoisted(() => ({ listAiConnectionsAction: vi.fn(), refreshAiConnectionsAction: vi.fn(), setBackupModelsAction: vi.fn() }))

vi.mock('@/app/api/_actions/workspace-connection.actions', () => ({
    listAiConnectionsAction: mocks.listAiConnectionsAction,
    refreshAiConnectionsAction: mocks.refreshAiConnectionsAction,
    createAiConnectionAction: vi.fn(),
    deleteAiConnectionAction: vi.fn(),
    setDefaultModelAction: vi.fn(),
    setBackupModelsAction: mocks.setBackupModelsAction,
    updateAiConnectionAction: vi.fn(),
    updateAiConnectionKeysAction: vi.fn(),
}))
vi.mock('@/hooks/useAgentContext', () => ({ invalidateLoadedAgentContexts: vi.fn() }))
vi.mock('@/lib/engine/ai-connection-analytics', () => ({ connectionMethod: vi.fn(), trackAiConnectionConnected: vi.fn(), trackAiConnectionFailed: vi.fn() }))
vi.mock('@rerun/analytics/client', () => ({ track: vi.fn() }))

function connection(id: string, planPercent: number): BoxConnection {
    return {
        id,
        name: 'Claude',
        provider: 'claude',
        models: ['claude-opus-5-5'],
        extraModels: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        connected: true,
        credentialRejected: false,
        planLimits: { windows: [{ kind: 'session', label: null, usedPercent: planPercent, resetsAt: null }], capturedAt: '2026-10-05T11:55:00.000Z' },
        cliModels: null,
        providerModels: null,
        discoveredModels: null,
    }
}

const list = (connections: BoxConnection[]) => ({ connections, default: null, backups: { backups: [], rerunCreditLastResort: false }, opencodeOffered: false, customOffered: false })

let root: Root | null = null
let container: HTMLElement | null = null
let seen: BoxConnection[] = []

async function mount() {
    const { useWorkspaceConnections } = await import('./useWorkspaceConnections')
    function Probe() {
        seen = useWorkspaceConnections().connections
        return null
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(Probe)))
    await act(async () => {})
}

describe('refreshWorkspaceConnections', () => {
    beforeEach(() => {
        vi.resetModules()
        mocks.listAiConnectionsAction.mockReset()
        mocks.refreshAiConnectionsAction.mockReset()
        mocks.listAiConnectionsAction.mockResolvedValue(list([connection('c1', 42)]))
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    it('takes the fresh list when the engine answers', async () => {
        mocks.refreshAiConnectionsAction.mockResolvedValue(list([connection('c1', 61)]))
        await mount()
        expect(seen.map(c => c.planLimits?.windows[0]?.usedPercent)).toEqual([42])

        const { refreshWorkspaceConnections } = await import('./useWorkspaceConnections')
        await act(async () => refreshWorkspaceConnections())
        expect(seen.map(c => c.planLimits?.windows[0]?.usedPercent)).toEqual([61])
    })

    it('keeps the list it holds when the engine does not answer', async () => {
        mocks.refreshAiConnectionsAction.mockResolvedValue(null)
        await mount()

        const { refreshWorkspaceConnections } = await import('./useWorkspaceConnections')
        await act(async () => refreshWorkspaceConnections())
        expect(seen.map(c => c.id)).toEqual(['c1'])
    })

    it('adds two chats ending together up to one request', async () => {
        mocks.refreshAiConnectionsAction.mockResolvedValue(list([connection('c1', 61)]))
        await mount()

        const { refreshWorkspaceConnections } = await import('./useWorkspaceConnections')
        await act(async () => Promise.all([refreshWorkspaceConnections(), refreshWorkspaceConnections()]))
        expect(mocks.refreshAiConnectionsAction).toHaveBeenCalledTimes(1)
    })
})

describe('setBackups', () => {
    const next = { backups: [{ connectionId: 'c1', model: 'claude-opus-5-5' }], rerunCreditLastResort: true }
    let hook: { backups: unknown; setBackups: (list: BoxBackupModels) => Promise<{ success: boolean }> } | null = null

    async function mountHook() {
        const { useWorkspaceConnections } = await import('./useWorkspaceConnections')
        function Probe() {
            hook = useWorkspaceConnections()
            return null
        }
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => root!.render(createElement(Probe)))
        await act(async () => {})
    }

    beforeEach(() => {
        vi.resetModules()
        mocks.listAiConnectionsAction.mockReset()
        mocks.setBackupModelsAction.mockReset()
        mocks.listAiConnectionsAction.mockResolvedValue(list([connection('c1', 10)]))
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    it('shows the new list at once and keeps it once the engine took it', async () => {
        mocks.setBackupModelsAction.mockResolvedValue({ success: true })
        await mountHook()

        await act(async () => void (await hook!.setBackups(next)))

        expect(mocks.setBackupModelsAction).toHaveBeenCalledWith(next)
        expect(hook!.backups).toEqual(next)
    })

    // A reorder is several clicks in a row: the engine has to end on the last one.
    it('sends quick edits one after the other, in click order', async () => {
        const sent: unknown[] = []
        let release!: () => void
        mocks.setBackupModelsAction.mockImplementationOnce(async (list: unknown) => {
            sent.push(list)
            await new Promise<void>(r => (release = r))
            return { success: true }
        })
        mocks.setBackupModelsAction.mockImplementation(async (list: unknown) => {
            sent.push(list)
            return { success: true }
        })
        await mountHook()
        const last = { ...next, rerunCreditLastResort: false }

        let both!: Promise<unknown>
        await act(async () => {
            both = Promise.all([hook!.setBackups(next), hook!.setBackups(last)])
        })
        expect(sent).toEqual([next])
        await act(async () => {
            release()
            await both
        })

        expect(sent).toEqual([next, last])
        expect(hook!.backups).toEqual(last)
    })

    it('puts the previous list back when the engine refuses it', async () => {
        mocks.setBackupModelsAction.mockResolvedValue({ success: false })
        await mountHook()

        await act(async () => void (await hook!.setBackups(next)))

        expect(hook!.backups).toEqual({ backups: [], rerunCreditLastResort: false })
    })
})

describe('the AI providers panel opening', () => {
    const realFetch = globalThis.fetch
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.resetModules()
        mocks.listAiConnectionsAction.mockReset()
        fetchMock = vi.fn()
        globalThis.fetch = fetchMock as unknown as typeof fetch
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
        globalThis.fetch = realFetch
    })

    const routeAnswers = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))
    const percents = () => seen.map(c => c.planLimits?.windows[0]?.usedPercent)

    async function mountProbe(Probe: () => null) {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => root!.render(createElement(Probe)))
        await act(async () => {})
    }

    async function mountWith(options: { revalidate?: boolean }) {
        const { useWorkspaceConnections } = await import('./useWorkspaceConnections')
        await mountProbe(() => {
            seen = useWorkspaceConnections(options).connections
            return null
        })
    }

    // A Server Action holds every later action of the tab: the panel's read, which waits on the
    // engine, must not be one.
    it('reads fresh plan usage through the route, where a model picker uses the action', async () => {
        mocks.listAiConnectionsAction.mockResolvedValue(list([connection('c1', 40)]))
        routeAnswers(list([connection('c1', 66)]))
        await mountWith({})
        expect(mocks.listAiConnectionsAction).toHaveBeenCalledTimes(1)
        expect(fetchMock).not.toHaveBeenCalled()

        await act(async () => root!.unmount())
        await mountWith({ revalidate: true })
        expect(fetchMock).toHaveBeenCalledWith('/api/ai-connections', { cache: 'no-store' })
        expect(mocks.listAiConnectionsAction).toHaveBeenCalledTimes(1)
        expect(percents()).toEqual([66])
    })

    it('falls back on the plain list when the route cannot answer', async () => {
        mocks.listAiConnectionsAction.mockResolvedValue(list([connection('c1', 40)]))
        routeAnswers({ error: 'Unauthorized' }, 401)
        await mountWith({ revalidate: true })
        expect(mocks.listAiConnectionsAction).toHaveBeenCalledTimes(1)
        expect(percents()).toEqual([40])
    })

    it('shows a plain list that answers first while the fresh one is still reading', async () => {
        let answerFresh: (value: Response) => void = () => {}
        fetchMock.mockImplementation(() => new Promise(resolve => (answerFresh = resolve)))
        mocks.listAiConnectionsAction.mockResolvedValue(list([connection('c1', 40)]))
        const { useWorkspaceConnections } = await import('./useWorkspaceConnections')
        let loading = true
        await mountProbe(() => {
            useWorkspaceConnections()
            const panel = useWorkspaceConnections({ revalidate: true })
            seen = panel.connections
            loading = panel.loading
            return null
        })
        expect(loading).toBe(false)
        expect(percents()).toEqual([40])

        await act(async () => answerFresh(new Response(JSON.stringify(list([connection('c1', 66)])))))
        await act(async () => {})
        expect(percents()).toEqual([66])
    })

    it('keeps the fresh reading when a plain list sent before it answers last', async () => {
        let answerPlain: (value: unknown) => void = () => {}
        mocks.listAiConnectionsAction.mockImplementation(() => new Promise(resolve => (answerPlain = resolve)))
        routeAnswers(list([connection('c1', 66)]))
        const { useWorkspaceConnections } = await import('./useWorkspaceConnections')
        await mountProbe(() => {
            useWorkspaceConnections()
            seen = useWorkspaceConnections({ revalidate: true }).connections
            return null
        })
        await act(async () => answerPlain(list([connection('c1', 40)])))
        expect(percents()).toEqual([66])
    })
})
