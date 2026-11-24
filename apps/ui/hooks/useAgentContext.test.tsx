// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A default the Chief of Staff changes shows in the app at the end of its turn, not after a reload
// (RER-284).

const mocks = vi.hoisted(() => ({ getAgentContextAction: vi.fn() }))
vi.mock('@/app/api/_actions/agent.actions', () => ({ getAgentContextAction: mocks.getAgentContextAction }))

const pinned = (model: string) => ({ model: { connectionId: 'claude-1', model, effort: null, resolvedConnectionId: 'claude-1', resolvedModel: model, loaded: true }, setup: null })

const toolPart = (toolName: string, input: unknown, state = 'output-available') => ({ type: 'dynamic-tool', toolName, toolCallId: `call-${toolName}`, state, input, output: {} })

let roots: Root[] = []

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

// What a model picker of the coworker shows, as long as it stays open.
async function showModelOf(agentId: string): Promise<() => string | null | undefined> {
    const { useAgentContext } = await import('@/hooks/useAgentContext')
    let model: string | null | undefined
    function Picker() {
        model = useAgentContext(agentId).context?.model.model
        return null
    }
    const root = createRoot(document.createElement('div'))
    roots.push(root)
    await act(async () => root.render(createElement(Picker)))
    await settle()
    return () => model
}

describe('reReadAgentsChangedBy', () => {
    beforeEach(() => {
        vi.resetModules()
        mocks.getAgentContextAction.mockReset()
    })
    afterEach(() => {
        for (const root of roots) act(() => root.unmount())
        roots = []
    })

    it("shows the model the Chief of Staff gave a coworker without a reload", async () => {
        mocks.getAgentContextAction.mockResolvedValue(pinned('claude-sonnet-5-5'))
        const modelOfMorning = await showModelOf('morning')
        expect(modelOfMorning()).toBe('claude-sonnet-5-5')

        mocks.getAgentContextAction.mockResolvedValue(pinned('gpt-6-luna'))
        const { reReadAgentsChangedBy } = await import('@/hooks/useAgentContext')
        await act(async () => reReadAgentsChangedBy([{ type: 'text' }, toolPart('mcp__rerun__update_agent', { agentId: 'morning', connectionId: 'codex-1', model: 'gpt-6-luna' })]))
        await settle()

        expect(mocks.getAgentContextAction).toHaveBeenCalledTimes(2)
        expect(modelOfMorning()).toBe('gpt-6-luna')
    })

    it('reads every coworker shown again after the workspace default moved', async () => {
        mocks.getAgentContextAction.mockResolvedValue(pinned('claude-sonnet-5-5'))
        await showModelOf('odin')
        await showModelOf('muso')
        mocks.getAgentContextAction.mockClear()

        const { reReadAgentsChangedBy } = await import('@/hooks/useAgentContext')
        await act(async () => reReadAgentsChangedBy([toolPart('set_default_model', { connectionId: 'claude-2', model: 'claude-sonnet-5-5' })]))
        await settle()

        expect(mocks.getAgentContextAction.mock.calls.map(([agentId]) => agentId).sort()).toEqual(['muso', 'odin'])
    })

    it('reads nothing again for a change that failed, another tool, or a coworker no picker shows', async () => {
        mocks.getAgentContextAction.mockResolvedValue(pinned('claude-sonnet-5-5'))
        await showModelOf('morning')
        mocks.getAgentContextAction.mockClear()

        const { reReadAgentsChangedBy } = await import('@/hooks/useAgentContext')
        await act(async () =>
            reReadAgentsChangedBy([
                toolPart('update_agent', { agentId: 'morning', model: 'gpt-6-luna' }, 'output-error'),
                toolPart('update_agent', { agentId: 'morning', model: 'gpt-6-luna' }, 'input-available'),
                toolPart('list_agents', {}),
                toolPart('update_agent', { agentId: 'never-shown', model: 'gpt-6-luna' }),
            ])
        )
        await settle()

        expect(mocks.getAgentContextAction).not.toHaveBeenCalled()
    })
})
