// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The picker writes the conversation's override, which the chat transport sends with every message.
// One it writes on its own pins the conversation for good: a workspace running on Claude ended up
// spending its Rerun credit, and being told it was used up, after a single failed read of the agent.

const mocks = vi.hoisted(() => ({ getAgentContextAction: vi.fn(), listAiConnectionsAction: vi.fn() }))

vi.mock('@/app/api/_actions/agent.actions', () => ({ getAgentContextAction: mocks.getAgentContextAction, updateAgentConfigAction: vi.fn() }))
vi.mock('@/app/api/_actions/workspace-connection.actions', () => ({
    listAiConnectionsAction: mocks.listAiConnectionsAction,
    createAiConnectionAction: vi.fn(),
    deleteAiConnectionAction: vi.fn(),
    setDefaultModelAction: vi.fn(),
    updateAiConnectionAction: vi.fn(),
    updateAiConnectionKeysAction: vi.fn(),
}))
vi.mock('@/supabase/session/SessionProvider', () => ({
    useSession: () => ({ workspace: { id: 1, subscription_status: 'trialing', is_sandbox: false, rerun_budget_micros: 0, rerun_used_micros: 0, rerun_topup_micros: 0 } }),
    useOptionalSession: () => null,
}))
vi.mock('@rerun/analytics/client', () => ({ track: vi.fn() }))

const connection = (id: string, provider: string, models: string[]) => ({
    id,
    name: id === 'rerun' ? 'Rerun' : 'Claude',
    provider,
    models,
    extraModels: [],
    createdAt: '2026-11-04T10:00:00.000Z',
    connected: true,
    credentialRejected: false,
    planLimits: null,
    cliModels: null,
    providerModels: null,
})

const CLAUDE_DEFAULT = {
    connections: [connection('rerun', 'rerun', ['rerun-max', 'rerun-fast', 'rerun-smart']), connection('claude-1', 'claude', ['claude-sonnet-5-5', 'claude-opus-5-5'])],
    default: { connectionId: 'claude-1', model: 'claude-sonnet-5-5' },
    opencodeOffered: false,
}

const modelContext = (model: Record<string, unknown>) => ({ model: { connectionId: null, model: null, resolvedConnectionId: null, resolvedModel: null, loaded: true, ...model }, setup: null })
const FAILED_READ = modelContext({ loaded: false })
const FOLLOWS_CLAUDE = modelContext({ resolvedConnectionId: 'claude-1', resolvedModel: 'claude-sonnet-5-5' })

let root: Root | null = null
let container: HTMLElement | null = null

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

async function mount(agentId: string, onReadyChange?: (ready: boolean) => void) {
    const { ModelSelector } = await import('@/components/agent/ModelSelector')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(createElement(ModelSelector, { agentId, onReadyChange }))
    })
    await settle()
}

const storedOverride = (agentId: string) => {
    const raw = localStorage.getItem(`rerun-agent-model-${agentId}`)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

describe('ModelSelector override', () => {
    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        mocks.getAgentContextAction.mockReset()
        mocks.listAiConnectionsAction.mockResolvedValue(CLAUDE_DEFAULT)
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    it('writes nothing for an agent that follows a usable Box default', async () => {
        mocks.getAgentContextAction.mockResolvedValue(FOLLOWS_CLAUDE)
        const onReadyChange = vi.fn()
        await mount('follows', onReadyChange)
        expect(storedOverride('follows')).toBeNull()
        expect(onReadyChange).toHaveBeenLastCalledWith(true)
    })

    it('writes nothing after a failed read of the agent', async () => {
        mocks.getAgentContextAction.mockResolvedValueOnce(FAILED_READ).mockResolvedValue(FOLLOWS_CLAUDE)
        await mount('flaky')
        expect(storedOverride('flaky')).toBeNull()
    })

    it('leaves an agent following the Box alone when the picker cannot show what the engine resolved', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ resolvedConnectionId: 'rerun', resolvedModel: 'rerun-fast' }))
        const onReadyChange = vi.fn()
        await mount('hidden-default', onReadyChange)
        expect(storedOverride('hidden-default')).toBeNull()
        expect(onReadyChange).toHaveBeenLastCalledWith(true)
    })

    it('repoints a pin that no longer resolves at the Box default, not at Rerun', async () => {
        mocks.getAgentContextAction.mockResolvedValue(modelContext({ connectionId: 'gone', model: 'gpt-6-astra', resolvedConnectionId: 'gone', resolvedModel: 'gpt-6-astra' }))
        await mount('stale-pin')
        expect(storedOverride('stale-pin')).toEqual({ connectionId: 'claude-1', model: 'claude-sonnet-5-5' })
    })
})
