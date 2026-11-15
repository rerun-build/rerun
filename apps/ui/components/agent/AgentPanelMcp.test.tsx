// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Session = { states: Map<string, { state: string; errorClass?: string }>; reconnecting: Set<string>; reconnect: ReturnType<typeof vi.fn> }

const mocks = vi.hoisted(() => ({
    getAgentDetailAction: vi.fn(),
    patchAgentMcpServersAction: vi.fn(),
    canManage: { value: true },
    session: { value: null as unknown },
}))

vi.mock('@/app/api/_actions/agent.actions', () => ({ getAgentDetailAction: mocks.getAgentDetailAction, patchAgentMcpServersAction: mocks.patchAgentMcpServersAction }))
vi.mock('@/hooks/useBoxAccess', () => ({ useCanManageAgent: () => mocks.canManage.value }))
vi.mock('@/hooks/useBoxManageReason', () => ({ useBoxManageReason: () => 'no access' }))
vi.mock('@/hooks/useConnectorServices', () => ({ useConnectorServices: () => ({ map: new Map(), loaded: true }), invalidateConnectorServices: vi.fn() }))
vi.mock('@/hooks/useMcpServerStatuses', () => ({ refreshMcpServerStatuses: vi.fn() }))
vi.mock('@/hooks/useMcpSession', () => ({ useMcpSession: () => mocks.session.value }))
vi.mock('@/components/agent/McpServerEditor', () => ({ McpServerEditor: () => createElement('div', { 'data-testid': 'editor' }) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

const SERVERS = [
    { name: 'alpha', transport: 'http', url: 'https://a.example' },
    { name: 'beta', transport: 'http', url: 'https://b.example' },
]

let root: Root | null = null
let container: HTMLElement | null = null

function session(states: Record<string, { state: string; errorClass?: string }>, reconnecting: string[] = [], result = { ok: true }): Session {
    return { states: new Map(Object.entries(states)), reconnecting: new Set(reconnecting), reconnect: vi.fn().mockResolvedValue(result) }
}

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

async function mount() {
    const { AgentPanelMcp } = await import('@/components/agent/AgentPanelMcp')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(createElement(AgentPanelMcp, { agentId: 'a1' }))
    })
    await settle()
}

const reconnectButtons = () => Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).filter(b => b.textContent === 'reconnect')

describe('AgentPanelMcp', { timeout: 20_000 }, () => {
    beforeEach(() => {
        vi.resetModules()
        mocks.canManage.value = true
        mocks.getAgentDetailAction.mockReset().mockResolvedValue({ config: { mcpServers: SERVERS } })
        mocks.session.value = session({ alpha: { state: 'connected' }, beta: { state: 'failed', errorClass: 'auth' } })
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    it('shows each server with its state', async () => {
        await mount()
        const text = container!.textContent!
        expect(text).toContain('state.connected')
        expect(text).toContain('state.failed')
        expect(text).toContain('errorClass.auth')
    })

    it('shows a Reconnect button per server and calls reconnect with that server name', async () => {
        const s = session({ alpha: { state: 'connected' }, beta: { state: 'failed', errorClass: 'auth' } })
        mocks.session.value = s
        await mount()
        const buttons = reconnectButtons()
        expect(buttons).toHaveLength(2)
        await act(async () => buttons[1].click())
        await settle()
        expect(s.reconnect).toHaveBeenCalledWith('beta')
    })

    it('a click on Reconnect does not open the server editor', async () => {
        await mount()
        await act(async () => reconnectButtons()[0].click())
        await settle()
        expect(container!.querySelector('[data-testid="editor"]')).toBeNull()
    })

    it('disables Reconnect while a server is connecting or reconnecting', async () => {
        mocks.session.value = session({ alpha: { state: 'connecting' }, beta: { state: 'connected' } }, ['beta'])
        await mount()
        const buttons = reconnectButtons()
        expect(buttons[0].disabled).toBe(true)
        expect(buttons[1].disabled).toBe(true)
        expect(container!.textContent).toContain('state.reconnecting')
    })

    it('disables Reconnect for someone who cannot manage the coworker', async () => {
        mocks.canManage.value = false
        await mount()
        for (const b of reconnectButtons()) expect(b.disabled).toBe(true)
    })

    it('shows the failure text when reconnect fails', async () => {
        mocks.session.value = session({ alpha: { state: 'connected' }, beta: { state: 'connected' } }, [], { ok: false })
        await mount()
        await act(async () => reconnectButtons()[0].click())
        await settle()
        expect(container!.textContent).toContain('reconnectFailed')
    })
})
