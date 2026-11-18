// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoxBackupModels, BoxConnection } from '@/lib/engine/types'
import { TooltipProvider } from '@/components/ui/tooltip'

// The panel the group sits in reads the session; the group itself only needs its props.
vi.mock('@/supabase/session/SessionProvider', () => ({ useIsWorkspaceAdmin: () => true }))
vi.mock('@/hooks/useWorkspaceConnections', () => ({ useWorkspaceConnections: () => ({}) }))
vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))

const { BackupsGroup } = await import('./BackupsGroup')

function connection(id: string, name: string, provider: BoxConnection['provider'], models: string[]): BoxConnection {
    return { id, name, provider, models, extraModels: [], createdAt: '2026-01-01T00:00:00.000Z', connected: true, credentialRejected: false, planLimits: null, cliModels: null, providerModels: null, discoveredModels: null }
}

const CONNECTIONS = [connection('rerun', 'Rerun', 'rerun', ['rerun-max']), connection('claude', 'Claude', 'claude', ['claude-opus-5-5']), connection('chatgpt', 'ChatGPT', 'codex', ['gpt-6-sol']), connection('opencode', 'OpenCode', 'opencode', ['go/deepseek-v4-pro'])]
const CREDIT = { budgetMicros: 0, usedMicros: 0, percent: 0, resetAt: null, paused: false } as never
const BACKUPS: BoxBackupModels = {
    backups: [
        { connectionId: 'chatgpt', model: 'gpt-6-sol' },
        { connectionId: 'opencode', model: 'go/deepseek-v4-pro' },
    ],
    rerunCreditLastResort: false,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

function render(onChange: (next: BoxBackupModels) => void, readOnlyReason?: string, connections = CONNECTIONS) {
    act(() => root.render(createElement(TooltipProvider, null, createElement(BackupsGroup, { connections, backups: BACKUPS, current: { connectionId: 'claude', model: 'claude-opus-5-5' }, credit: CREDIT, onChange, readOnlyReason }))))
}

const button = (label: string) => {
    const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!found) throw new Error(`no button labelled "${label}"`)
    return found
}

describe('BackupsGroup', () => {
    it('lists the backups in their order, with their rank and source', () => {
        render(vi.fn())
        expect(container.textContent).toContain('1st · via ChatGPT')
        expect(container.textContent).toContain('2nd · via OpenCode')
        expect(container.textContent).toContain('Rerun credit as last resort')
    })

    it('marks a backup as skipped once its model is switched off on the connection', () => {
        render(
            vi.fn(),
            undefined,
            CONNECTIONS.map(c => (c.id === 'chatgpt' ? { ...c, models: [] } : c)),
        )
        expect(container.textContent).toContain('1st · ChatGPT is not ready, skipped')
        expect(container.textContent).toContain('2nd · via OpenCode')
    })

    it('moves a backup and removes one, writing the whole list', () => {
        const onChange = vi.fn()
        render(onChange)
        expect(button('Move GPT-6 Sol up').disabled).toBe(true)
        act(() => button('Move GPT-6 Sol down').click())
        expect(onChange).toHaveBeenLastCalledWith({ ...BACKUPS, backups: [BACKUPS.backups[1], BACKUPS.backups[0]] })
        act(() => button('Remove GPT-6 Sol').click())
        expect(onChange).toHaveBeenLastCalledWith({ ...BACKUPS, backups: [BACKUPS.backups[1]] })
    })

    it('switches the Rerun credit on only when asked', () => {
        const onChange = vi.fn()
        render(onChange)
        const toggle = button('Rerun credit as last resort')
        expect(toggle.getAttribute('aria-checked')).toBe('false')
        act(() => toggle.click())
        expect(onChange).toHaveBeenLastCalledWith({ ...BACKUPS, rerunCreditLastResort: true })
    })

    it('keeps everything in place but disabled for a member', () => {
        render(vi.fn(), 'Only an admin can change the AI providers')
        expect(button('Move GPT-6 Sol down').disabled).toBe(true)
        expect(button('Remove GPT-6 Sol').disabled).toBe(true)
        expect(button('Rerun credit as last resort').disabled).toBe(true)
    })
})
