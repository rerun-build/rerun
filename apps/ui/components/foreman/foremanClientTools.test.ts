import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ openWorkspacePanel: vi.fn(), openVault: vi.fn(), openBilling: vi.fn() }))

vi.mock('@/stores/workspace-settings.store', () => ({ useWorkspaceSettingsStore: { getState: () => ({ openWorkspacePanel: mocks.openWorkspacePanel, openVault: mocks.openVault }) } }))
vi.mock('@/stores/billing.store', () => ({ useBillingStore: { getState: () => ({ openBilling: mocks.openBilling }) } }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: { getState: () => ({ agents: [] }) } }))
vi.mock('@/stores/account.store', () => ({ useAccountStore: { getState: () => ({}) } }))
vi.mock('@/stores/notifications.store', () => ({ useNotificationsStore: { getState: () => ({}) } }))
vi.mock('@/stores/shortcuts.store', () => ({ useShortcutsStore: { getState: () => ({}) } }))
vi.mock('@/stores/template-flow.store', () => ({ useTemplateFlowStore: { getState: () => ({}) } }))

const { runForemanClientTool } = await import('./foremanClientTools')

const admin = { apiEntitled: true, apiLocked: false, isSandbox: false, isAdmin: true, vaultOpen: true }
const member = { ...admin, isAdmin: false }

describe('open_settings', () => {
    beforeEach(() => vi.clearAllMocks())

    // The workspace menu greys these two for a member: the foreman's door has to be shut the same way,
    // or the dialog opens with buttons the server then refuses.
    it('refuses the workspace settings and the API keys to a member, with a reason the foreman can say', () => {
        for (const panel of ['workspace', 'api_keys']) {
            const out = runForemanClientTool('open_settings', { panel }, member)
            expect(out.ok).toBe(false)
            expect(out.ok ? '' : out.error).toContain('Only an admin')
        }
        expect(mocks.openWorkspacePanel).not.toHaveBeenCalled()
    })

    it('still opens the members and the AI providers to a member, and everything to an admin', () => {
        expect(runForemanClientTool('open_settings', { panel: 'members' }, member).ok).toBe(true)
        expect(runForemanClientTool('open_settings', { panel: 'ai_providers' }, member).ok).toBe(true)
        expect(runForemanClientTool('open_settings', { panel: 'api_keys' }, admin).ok).toBe(true)
        expect(mocks.openWorkspacePanel.mock.calls.map(call => call[0])).toEqual(['members', 'ai_providers', 'api_keys'])
    })
})

describe('open_settings on a tier without the API', () => {
    it('keeps the API keys shut and does not offer billing', () => {
        vi.clearAllMocks()
        const out = runForemanClientTool('open_settings', { panel: 'api_keys' }, { ...admin, apiEntitled: false, apiLocked: true })
        expect(out.ok ? '' : out.error).toContain('not included in the AppSumo tier')
        expect(mocks.openWorkspacePanel).not.toHaveBeenCalled()
        expect(mocks.openBilling).not.toHaveBeenCalled()
    })
})

describe('open_vault', () => {
    beforeEach(() => vi.clearAllMocks())

    it('opens the Vault on the entry it names, or on its list', () => {
        expect(runForemanClientTool('open_vault', { entryId: 'item-notion' }, member).ok).toBe(true)
        expect(runForemanClientTool('open_vault', {}, member).ok).toBe(true)
        expect(mocks.openVault.mock.calls).toEqual([['item-notion'], [undefined]])
    })

    // The workspace menu greys the Vault without a plan.
    it('stays shut without a plan, with a reason the foreman can say', () => {
        const out = runForemanClientTool('open_vault', { entryId: 'item-notion' }, { ...admin, vaultOpen: false })
        expect(out.ok ? '' : out.error).toContain('active plan')
        expect(mocks.openVault).not.toHaveBeenCalled()
    })
})
