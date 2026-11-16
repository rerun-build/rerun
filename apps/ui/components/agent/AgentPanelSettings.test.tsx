// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAgentDetailAction: vi.fn(), updateAgentConfigAction: vi.fn() }))

vi.mock('@/app/api/_actions/agent.actions', () => ({ getAgentDetailAction: mocks.getAgentDetailAction, updateAgentConfigAction: mocks.updateAgentConfigAction }))
vi.mock('@/hooks/useErrorText', () => ({ useErrorText: () => () => 'error' }))
vi.mock('@/hooks/useBoxAccess', () => ({ useCanManageAgent: () => true }))
vi.mock('@/hooks/useBoxManageReason', () => ({ useBoxManageReason: () => undefined }))
vi.mock('@/hooks/useTemplateContentLock', () => ({ useTemplateContentLock: () => false }))
vi.mock('@/components/agent/AgentAccessRow', () => ({ AgentAccessRow: () => null }))
vi.mock('@/components/agent/share/SharedLinksSection', () => ({ SharedLinksSection: () => null }))
vi.mock('@/components/agent/TemplateContentLock', () => ({ TemplateContentLock: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/dialogs/DeleteAgentDialog', () => ({ DeleteAgentDialog: ({ children }: { children: unknown }) => children }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: { renameAgent: () => void }) => unknown) => select({ renameAgent: vi.fn() }) }))
vi.mock('@/stores/notifications.store', () => ({ useNotificationsStore: (select: (state: { openNotifications: () => void }) => unknown) => select({ openNotifications: vi.fn() }) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

const AGENT = { id: 'a1', name: 'Ada', disabledAt: null } as never

const detail = (config: Record<string, unknown>) => ({ soul: 'soul', config: { verbosity: 'normal', provider: 'claude', thinkingLevel: null, ...config } })

let root: Root | null = null
let container: HTMLElement | null = null

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

async function mount() {
    const { AgentPanelSettings } = await import('@/components/agent/AgentPanelSettings')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(createElement(AgentPanelSettings, { agent: AGENT }))
    })
    await settle()
}

const button = (label: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="thinking-level"] button[aria-label="${label}"]`)!

async function save() {
    await act(async () => {
        container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()
}

describe('AgentPanelSettings thinking level', { timeout: 20_000 }, () => {
    beforeEach(() => {
        vi.resetModules()
        mocks.getAgentDetailAction.mockReset()
        mocks.updateAgentConfigAction.mockReset().mockResolvedValue({ success: true })
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
    })

    it('sends the chosen level in the PATCH', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({}))
        await mount()
        await act(async () => button('thinking.high').click())
        await save()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('a1', expect.objectContaining({ thinkingLevel: 'high' }))
    })

    it('offers xhigh and sends it in the PATCH', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({}))
        await mount()
        await act(async () => button('thinking.xhigh').click())
        await save()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('a1', expect.objectContaining({ thinkingLevel: 'xhigh' }))
    })

    it('sends null for "Not set"', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({ thinkingLevel: 'low' }))
        await mount()
        expect(button('thinking.low').getAttribute('aria-pressed')).toBe('true')
        await act(async () => button('thinking.none').click())
        await save()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('a1', expect.objectContaining({ thinkingLevel: null }))
    })

    it('shows the control disabled on a provider without a thinking option', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({ provider: 'codex' }))
        await mount()
        const control = container!.querySelector('[data-testid="thinking-level"]')!
        expect(control.getAttribute('aria-disabled')).toBe('true')
        expect(container!.textContent).toContain('thinking.unsupported')
    })

    it('keeps the control enabled on a supported provider', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({}))
        await mount()
        expect(container!.querySelector('[data-testid="thinking-level"]')!.getAttribute('aria-disabled')).toBe('false')
    })
})
