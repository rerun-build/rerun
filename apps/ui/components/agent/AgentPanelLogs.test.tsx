// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineRun } from '@/lib/engine/types'

// The runs list is three tabs, Running, Done and Failed. It always opens on Running; the search filters the open tab.

const mocks = vi.hoisted(() => ({
    listRunsAction: vi.fn(),
    getRunStepsAction: vi.fn(async () => []),
    getRunToolsAction: vi.fn(async (..._a: string[]): Promise<unknown[]> => []),
    readFactorySnapshotAction: vi.fn(),
}))
vi.mock('@/app/api/_actions/agent.actions', () => ({ listRunsAction: mocks.listRunsAction, getRunStepsAction: mocks.getRunStepsAction, getRunToolsAction: mocks.getRunToolsAction }))
vi.mock('@/app/api/_actions/factory.actions', () => ({ readFactorySnapshotAction: mocks.readFactorySnapshotAction }))
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
const tab = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(b => b.textContent?.startsWith(name))!
const rows = () => host.querySelectorAll('[data-run]')
const typeQuery = async (v: string) => { const input = host.querySelector<HTMLInputElement>('input[type="search"]')!; await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
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
    mocks.getRunToolsAction.mockResolvedValue([])
    mocks.readFactorySnapshotAction.mockResolvedValue({ snapshot: { jobs: [{ issue: 332, title: 'Fab floor', runs: [{ stage: 'build', runId: 'r1' }] }] }, receivedAt: 0, ageMs: 0 })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('AgentPanelLogs tabs', () => {
    it('opens on the Running tab with counts on all three tabs', async () => {
        store.set('rerun.agentLogs.filter', JSON.stringify({ running: false, failed: false, done: true }))
        await mount()
        const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map(b => b.textContent)
        expect(tabs).toEqual(['Running 2', 'Done 42', 'Failed 2'])
        expect(tab('Running').getAttribute('aria-selected')).toBe('true')
        expect(tab('Done').getAttribute('aria-selected')).toBe('false')
        expect(rows().length).toBe(2)
    })

    it('switches tabs and keeps the search', async () => {
        await mount()
        await act(async () => { tab('Done').click() })
        expect(rows().length).toBe(42)
        await typeQuery('nightly')
        expect(rows().length).toBe(1)
        await act(async () => { tab('Failed').click() })
        expect(rows().length).toBe(0)
        expect(host.textContent).toContain('No run matches "nightly"')
        await typeQuery('')
        expect(rows().length).toBe(2)
        await typeQuery('plan limit')
        expect(rows().length).toBe(1)
    })

    it('marks Failed red while it has runs and not at 0', async () => {
        await mount()
        expect(tab('Failed').hasAttribute('data-alert')).toBe(true)
        expect(tab('Failed').className).toContain('text-destructive')
        mocks.listRunsAction.mockResolvedValue(MANY.filter(r => r.status === 'running'))
        act(() => root.unmount())
        root = createRoot(host)
        await mount()
        expect(tab('Failed').textContent).toBe('Failed 0')
        expect(tab('Failed').hasAttribute('data-alert')).toBe(false)
        expect(tab('Failed').className).not.toContain('text-destructive')
    })

    it('says nothing is running in one line with links to Failed and Done', async () => {
        mocks.listRunsAction.mockResolvedValue(MANY.filter(r => r.status !== 'running'))
        await mount()
        expect(host.textContent).toContain('Nothing is running. See Failed or Done.')
        const link = Array.from(host.querySelectorAll<HTMLButtonElement>('button:not([role="tab"])')).find(b => b.textContent === 'Failed')!
        await act(async () => { link.click() })
        expect(tab('Failed').getAttribute('aria-selected')).toBe('true')
        expect(rows().length).toBe(2)
    })

    it('shows the empty state when there are no runs at all', async () => {
        mocks.listRunsAction.mockResolvedValue([])
        await mount()
        expect(host.textContent).toContain('No runs yet')
    })

    it('running rows show steps, elapsed time and the step they are on', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
        vi.setSystemTime(new Date('2026-11-14T10:01:30Z'))
        mocks.getRunToolsAction.mockImplementation(async (_a: string, id: string) => (id === 'r1' ? [{ toolName: 'read' }, { toolName: 'shell' }] : []))
        await mount()
        const [r1, r2] = Array.from(rows()) as HTMLElement[]
        expect(r1.textContent).toContain('3 steps')
        expect(r1.textContent).toContain('1m 30s')
        expect(r1.textContent).toContain('now: shell')
        expect(r2.textContent).not.toContain('now:')
        await act(async () => { vi.advanceTimersByTime(1000) })
        expect(r1.textContent).toContain('1m 31s')
        expect(r1.textContent).not.toContain('1m 30s')
    })

    it('runs no timer when nothing is running', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
        mocks.listRunsAction.mockResolvedValue(MANY.filter(r => r.status === 'done'))
        await mount()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('formats elapsed time', async () => {
        const { elapsed } = await import('./AgentPanelLogs')
        expect(elapsed(12_000)).toBe('12s')
        expect(elapsed(90_000)).toBe('1m 30s')
        expect(elapsed(91_000)).toBe('1m 31s')
        expect(elapsed(3_900_000)).toBe('1h 05m')
    })

    it('names the run: factory job with stage and title, else jobRef, else goal, trigger, start time', async () => {
        mocks.listRunsAction.mockResolvedValue([
            run('r1', 'done', { jobRef: 'rerun#332' }),
            run('x2', 'done', { jobRef: 'rerun#999' }),
            run('g1', 'done', { goal: { lastLineForms: [{ prefix: 'PR:' }] } as unknown as EngineRun['goal'] }),
            run('t1', 'done', { triggerSlug: 'nightly' }),
            run('b1', 'done'),
        ])
        await mount()
        await act(async () => { tab('Done').click() })
        const titles = Array.from(rows()).map(r => r.querySelector('span.truncate')?.textContent)
        expect(titles.slice(0, 4)).toEqual(['Build #332: Fab floor', 'rerun#999', 'Goal: PR:', 'nightly'])
        expect(titles[4]).toMatch(/2026/)
    })

    it('still opens a row once to its steps', async () => {
        await mount()
        const trigger = host.querySelector<HTMLButtonElement>('[data-run] button')!
        await act(async () => { trigger.click() })
        await settle()
        expect(mocks.getRunStepsAction).toHaveBeenCalledTimes(1)
    })

    it('keeps working when the snapshot read throws', async () => {
        mocks.readFactorySnapshotAction.mockRejectedValue(new Error('down'))
        mocks.listRunsAction.mockResolvedValue([run('r1', 'done', { jobRef: 'rerun#332' })])
        await mount()
        await act(async () => { tab('Done').click() })
        expect(rows()[0]!.textContent).toContain('rerun#332')
    })
})
