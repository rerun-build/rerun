// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    listSkillsAction: vi.fn(),
    importSkillAction: vi.fn(),
    setSkillEnabledAction: vi.fn(),
    canManage: { value: true },
    toastError: vi.fn(),
}))

vi.mock('@/app/api/_actions/agent.actions', () => ({
    listSkillsAction: mocks.listSkillsAction,
    importSkillAction: mocks.importSkillAction,
    setSkillEnabledAction: mocks.setSkillEnabledAction,
}))
vi.mock('@/hooks/useErrorText', () => ({ useErrorText: () => (failure: { error?: string }) => failure.error ?? 'error' }))
vi.mock('@/hooks/useBoxAccess', () => ({ useCanManageAgent: () => mocks.canManage.value }))
vi.mock('@/hooks/useAgentSkillSummaries', () => ({ setAgentSkillSummaries: vi.fn() }))
vi.mock('@/components/agent/skills/SkillEditor', () => ({ SkillEditor: () => createElement('div', { 'data-testid': 'editor' }) }))
vi.mock('@/components/ui/tooltip', () => ({ TooltipDisabledReason: ({ children }: { children: unknown }) => children }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
const translate = (key: string, values?: { name?: string }) => (key === 'offerSkill' ? `Offer ${values?.name} to this coworker` : key === 'offBadge' ? 'Off' : key)
vi.mock('next-intl', () => ({ useTranslations: () => translate }))

const skill = (slug: string, name: string, enabled: boolean) => ({ slug, name, description: `${name} d`, files: [], fromConnector: false, enabled })

let root: Root | null = null
let container: HTMLElement | null = null

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

async function mount() {
    const { AgentPanelSkills } = await import('@/components/agent/skills/AgentPanelSkills')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(createElement(AgentPanelSkills, { agentId: 'a1' }))
    })
    await settle()
}

const sw = (name: string) => container!.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="Offer ${name} to this coworker"]`)!
const rowOf = (name: string) => {
    let el: HTMLElement = sw(name)
    while (!el.textContent?.includes(`${name} d`)) el = el.parentElement!
    return el
}

describe('AgentPanelSkills on/off switch', { timeout: 20_000 }, () => {
    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        vi.resetModules()
        mocks.canManage.value = true
        mocks.toastError.mockReset()
        mocks.listSkillsAction.mockReset().mockResolvedValue([skill('on-skill', 'Alpha', true), skill('off-skill', 'Beta', false)])
        mocks.setSkillEnabledAction.mockReset().mockResolvedValue({ success: true })
    })

    afterEach(() => {
        act(() => root?.unmount())
        container?.remove()
        root = null
        container = null
    })

    it('shows each row state, its Off badge and an accessible name', async () => {
        await mount()
        expect(sw('Alpha').getAttribute('aria-checked')).toBe('true')
        expect(sw('Beta').getAttribute('aria-checked')).toBe('false')
        expect(rowOf('Beta').textContent).toContain('Off')
        expect(rowOf('Alpha').textContent).not.toContain('Off')
    })

    it('turns a skill on with one call and does not open the editor', async () => {
        await mount()
        await act(async () => {
            sw('Beta').click()
        })
        await settle()
        expect(mocks.setSkillEnabledAction).toHaveBeenCalledWith('a1', 'off-skill', true)
        expect(sw('Beta').getAttribute('aria-checked')).toBe('true')
        expect(rowOf('Beta').textContent).not.toContain('Off')
        expect(container!.querySelector('[data-testid="editor"]')).toBeNull()
    })

    it('puts the row back and shows an error when the save fails', async () => {
        mocks.setSkillEnabledAction.mockResolvedValue({ success: false, error: 'nope' })
        await mount()
        await act(async () => {
            sw('Beta').click()
        })
        await settle()
        expect(sw('Beta').getAttribute('aria-checked')).toBe('false')
        expect(mocks.toastError).toHaveBeenCalled()
    })

    it('disables the switches without manage access', async () => {
        mocks.canManage.value = false
        await mount()
        expect(sw('Alpha').disabled).toBe(true)
        expect(sw('Beta').disabled).toBe(true)
    })
})
