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
