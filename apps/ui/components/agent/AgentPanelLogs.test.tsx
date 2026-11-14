// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineRun } from '@/lib/engine/types'

// The runs list opens on what needs a look: Running and Failed on, Done off. The choice and the search
// are kept per browser, and a filtered-empty list says what is hidden.

const mocks = vi.hoisted(() => ({ listRunsAction: vi.fn(), getRunStepsAction: vi.fn(async () => []), getRunToolsAction: vi.fn(async () => []) }))
vi.mock('@/app/api/_actions/agent.actions', () => mocks)
vi.mock('@/hooks/useVisibleInterval', async () => {
    const { useEffect } = await import('react')
    return { useVisibleInterval: (cb: () => void) => useEffect(() => { void cb() }, [cb]) }
})

const run = (id: string, status: EngineRun['status'], extra: Partial<EngineRun> = {}): EngineRun => ({
    id, agentId: 'a1', sessionId: 's', status, stepCount: 3, usageJson: null, provider: 'claude', model: 'claude-x', triggerSource: null, triggerSlug: null,
    costMicros: null, inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, totalTokens: null,
    startedAt: '2026-11-14T10:00:00Z', finishedAt: null, error: null, ...extra,
})
const MANY = [
    run('r1', 'running'), run('r2', 'running'),
    run('e1', 'error', { error: 'boom' }), run('c1', 'cancelled', { error: 'plan limit' }), run('c2', 'cancelled'),
    ...Array.from({ length: 41 }, (_, i) => run(`d${i}`, 'done', { jobRef: i === 7 ? 'rerun#332' : null, triggerSlug: i === 3 ? 'nightly' : null })),
]

const store = new Map<string, string>()
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), get length() { return store.size } }

let host: HTMLDivElement
let root: Root
const chip = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-chip]')).find(b => b.textContent?.startsWith(name))!
const rowCount = () => host.querySelectorAll('[data-run-row], [data-state]').length
async function settle() { for (let i = 0; i < 5; i++) await act(async () => new Promise(r => setTimeout(r, 0))) }
async function mount() {
    const { AgentPanelLogs } = await import('./AgentPanelLogs')
    await act(async () => { root.render(createElement(AgentPanelLogs, { agentId: 'a1' })) })
    await settle()
}

beforeEach(() => {
    vi.stubGlobal('localStorage', storage)
    store.clear()
    mocks.listRunsAction.mockResolvedValue(MANY)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('AgentPanelLogs filters', () => {
    it('shows count chips Running 2, Failed 2 (an error, a cancel with an error), Done 42 (41 done and a cancel with no error)', async () => {
        await mount()
        expect(chip('Running').textContent).toBe('Running 2')
        expect(chip('Failed').textContent).toBe('Failed 2')
        expect(chip('Done').textContent).toBe('Done 42')
    })

    it('opens with Running and Failed on and Done off', async () => {
        await mount()
        expect(chip('Running').getAttribute('aria-pressed')).toBe('true')
        expect(chip('Failed').getAttribute('aria-pressed')).toBe('true')
        expect(chip('Done').getAttribute('aria-pressed')).toBe('false')
        expect(host.querySelectorAll('[data-run]').length).toBe(4)
    })

    it('turning Done on shows the done runs, and the choice is kept in localStorage and read back by a new mount', async () => {
        await mount()
        await act(async () => { chip('Done').click() })
        expect(host.querySelectorAll('[data-run]').length).toBe(46)
        act(() => root.unmount())
        root = createRoot(host)
        await mount()
        expect(chip('Done').getAttribute('aria-pressed')).toBe('true')
        expect(store.size).toBeGreaterThan(0)
    })

    it('searches the goal job, trigger, branch, model and error of a run', async () => {
        await mount()
        await act(async () => { chip('Done').click() })
        const input = host.querySelector<HTMLInputElement>('input[type="search"]')!
        const type = async (v: string) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
        await type('rerun#332')
        expect(host.querySelectorAll('[data-run]').length).toBe(1)
        await type('nightly')
        expect(host.querySelectorAll('[data-run]').length).toBe(1)
        await type('plan limit')
        expect(host.querySelectorAll('[data-run]').length).toBe(1)
    })

    it('says what is hidden when the filtered list is empty', async () => {
        mocks.listRunsAction.mockResolvedValue(MANY.filter(r => r.status === 'done'))
        await mount()
        expect(host.textContent).toContain('41 done runs hidden')
        mocks.listRunsAction.mockResolvedValue([...MANY.filter(r => r.status === 'done').slice(0, 1)])
        store.clear()
        act(() => root.unmount())
        root = createRoot(host)
        await mount()
        expect(host.textContent).toContain('1 done run hidden')
    })
})
