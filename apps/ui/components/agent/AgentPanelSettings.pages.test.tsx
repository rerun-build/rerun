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

const sw = (id: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!

async function save() {
    await act(async () => {
        container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()
}

describe('AgentPanelSettings page switches', { timeout: 20_000 }, () => {
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

    it('shows the skim switch off when pages is not set', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({}))
        await mount()
        expect(sw('pages-skim').getAttribute('aria-checked')).toBe('false')
    })

    it('sends no pages key when the switches were not touched', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({}))
        await mount()
        await save()
        expect(mocks.updateAgentConfigAction.mock.calls[0]![1]).not.toHaveProperty('pages')
    })

    it('sends pages.skim true after turning the switch on', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({}))
        await mount()
        await act(async () => sw('pages-skim').click())
        await save()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('a1', expect.objectContaining({ pages: { skim: true } }))
    })

    it('reads skim on from the saved config and sends false when turned off', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({ pages: { skim: true } }))
        await mount()
        expect(sw('pages-skim').getAttribute('aria-checked')).toBe('true')
        await act(async () => sw('pages-skim').click())
        await save()
        expect(mocks.updateAgentConfigAction).toHaveBeenCalledWith('a1', expect.objectContaining({ pages: { skim: false } }))
    })

    it('shows standing instructions as pages locked off', async () => {
        mocks.getAgentDetailAction.mockResolvedValue(detail({}))
        await mount()
        expect(sw('pages-standing').getAttribute('aria-checked')).toBe('false')
        expect(sw('pages-standing').disabled).toBe(true)
    })
})
