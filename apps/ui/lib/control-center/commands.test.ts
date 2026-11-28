import { describe, expect, it, vi } from 'vitest'

vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

import { buildControlCommands, pushRecentAgent, type ControlGates } from './commands'

const OPEN: ControlGates = { isSandbox: false, workspaceAdmin: true, apiEntitled: true, needsMachineReason: null, assistantReady: true, hasChangelog: true, darkTheme: false, supportAvailable: true }

function find(gates: Partial<ControlGates>, id: string) {
    return buildControlCommands({ ...OPEN, ...gates }).find(command => command.id === id)
}

describe('buildControlCommands', () => {
    it('leaves everything enabled on a live paid workspace', () => {
        expect(buildControlCommands(OPEN).filter(command => command.disabledReason || command.paid)).toEqual([])
    })

    it('keeps what needs the machine in the list, disabled with its reason', () => {
        const reason = 'Subscribe to restore your workspace first'
        expect(find({ needsMachineReason: reason }, 'new_agent')?.disabledReason).toBe(reason)
        expect(find({ needsMachineReason: reason }, 'browse_templates')?.disabledReason).toBe(reason)
        expect(find({ needsMachineReason: reason }, 'billing')?.disabledReason).toBeNull()
    })

    it('disables what a sandbox does not have', () => {
        for (const id of ['workspace', 'members', 'billing', 'new_box']) expect(find({ isSandbox: true }, id)?.disabledReason).toBeTruthy()
        expect(find({ isSandbox: true }, 'ai_providers')?.disabledReason).toBeNull()
    })

    it('disables what only an admin runs for a member, leaving the members list open', () => {
        for (const id of ['workspace', 'billing', 'api_keys']) expect(find({ workspaceAdmin: false }, id)?.disabledReason).toBe('Admins only')
        for (const id of ['members', 'ai_providers', 'new_agent', 'new_box']) expect(find({ workspaceAdmin: false }, id)?.disabledReason).toBeNull()
    })

    it('marks API keys as paid rather than disabling it', () => {
        expect(find({ apiEntitled: false }, 'api_keys')).toMatchObject({ paid: true, disabledReason: null })
    })

    it('drops the assistant and the changelog when there is nothing behind them', () => {
        expect(find({ assistantReady: false }, 'ask_assistant')).toBeUndefined()
        expect(find({ hasChangelog: false }, 'whats_new')).toBeUndefined()
    })

    it('keeps support reachable from a sandbox or a workspace without a machine', () => {
        expect(find({ isSandbox: true, needsMachineReason: 'Subscribe to restore your workspace first' }, 'contact_support')).toMatchObject({ disabledReason: null, paid: false })
    })

    it('names the theme it switches to', () => {
        expect(find({ darkTheme: true }, 'toggle_theme')?.label).toBe('Switch to light theme')
        expect(find({ darkTheme: false }, 'toggle_theme')?.label).toBe('Switch to dark theme')
    })
})

describe('pushRecentAgent', () => {
    it('puts the latest first without repeating it', () => {
        expect(pushRecentAgent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    })

    it('keeps five at most', () => {
        expect(pushRecentAgent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd'])
    })
})
