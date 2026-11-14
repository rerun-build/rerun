// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    answer: null as unknown,
    world: { current: null as null | Record<string, unknown> },
    board: {
        agents: [] as { id: string; name: string; handle?: string }[],
        hydrated: false,
        hydrate: vi.fn(),
        focusAgentOnBoard: vi.fn(),
    },
    workspace: { id: 7 } as { id: number } | null,
}))

vi.mock('@/app/api/_actions/factory.actions', () => ({ readFactorySnapshotAction: () => Promise.resolve(mocks.answer) }))
vi.mock('@/components/factory/FactoryWorld', () => ({
    FactoryWorld: (props: Record<string, unknown>) => {
        mocks.world.current = props
        return createElement('div', { 'data-world': '', 'data-selected': String(props.selectedIssue ?? '') })
    },
}))
vi.mock('@/components/agent/AgentPanel', () => ({ AgentPanel: () => createElement('div', { 'data-agent-panel': '' }) }))
vi.mock('@/stores/board.store', () => ({
    useBoardStore: Object.assign((select: (s: typeof mocks.board) => unknown) => select(mocks.board), { getState: () => mocks.board }),
}))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: mocks.workspace }) }))

import FactoryPage from './page'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const job = (issue: number, over: Record<string, unknown> = {}) => ({
    issue, title: `Job ${issue}`, state: 'building', enteredAt: iso(NOW - 12_000), pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: null, dependsOn: [], reason: null, ...over,
})
const snapshotWith = (jobs: unknown[], coworkers: unknown[] = [{ name: 'code', id: 'c1', runs: 1, out: 0 }]) => ({
    snapshot: {
        repo: 'o/r', jobs, pools: [{ name: 'build', coworkers }],
        endedToday: { merged: 0, rejected: 0, blocked: 0, failed: 0, returned: 0 },
    },
    receivedAt: NOW, ageMs: 0,
})

let host: HTMLDivElement
let root: Root
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const mount = async () => { await act(async () => { root.render(createElement(FactoryPage)) }); await flush() }
const remount = async () => { act(() => root.unmount()); root = createRoot(host); await mount() }
const world = () => mocks.world.current as { selectedIssue: number | null; onSelectJob: (n: number) => void; onOpenCoworker: (n: string) => void }
const byText = (sel: string, text: string) => Array.from(host.querySelectorAll<HTMLElement>(sel)).find(e => e.textContent?.trim() === text)
const click = (el: Element | undefined) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.answer = null
    mocks.world.current = null
    mocks.workspace = { id: 7 }
    Object.assign(mocks.board, { agents: [], hydrated: false })
    mocks.board.hydrate.mockReset()
    mocks.board.focusAgentOnBoard.mockReset()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe('factory page', () => {
    it('mounts the coworker panel and the two tabs', async () => {
        await mount()
        expect(host.querySelector('[data-agent-panel]')).not.toBeNull()
        expect(byText('button', 'Tasks')).toBeDefined()
        expect(byText('button', 'Inspect')).toBeDefined()
    })

    it('hydrates the board store once when it is not hydrated, and not when it is', async () => {
        await mount()
        await act(async () => { root.render(createElement(FactoryPage)) })
        expect(mocks.board.hydrate).toHaveBeenCalledTimes(1)
        expect(mocks.board.hydrate).toHaveBeenCalledWith(7)
        mocks.board.hydrate.mockReset()
        mocks.board.hydrated = true
        await remount()
        expect(mocks.board.hydrate).not.toHaveBeenCalled()
    })

    it('selecting a job in the list selects it for the inspector and the floor, and opens Inspect', async () => {
        mocks.answer = snapshotWith([job(11), job(12)])
        await mount()
        await click(host.querySelector('[data-row]')!)
        expect(world().selectedIssue).toBe(11)
        expect(host.querySelector('[data-world]')?.getAttribute('data-selected')).toBe('11')
        expect(host.textContent).toContain('Job 11')
        expect(byText('button', 'Inspect')?.getAttribute('aria-pressed')).toBe('true')
    })

    it('Escape clears the selection', async () => {
        mocks.answer = snapshotWith([job(11)])
        await mount()
        await act(async () => { world().onSelectJob(11) })
        expect(world().selectedIssue).toBe(11)
        await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
        expect(world().selectedIssue).toBeNull()
    })

    it('a sphere click from the floor selects the job', async () => {
        mocks.answer = snapshotWith([job(11), job(12)])
        await mount()
        await act(async () => { world().onSelectJob(12) })
        expect(world().selectedIssue).toBe(12)
        expect(byText('button', 'Inspect')?.getAttribute('aria-pressed')).toBe('true')
    })

    it('a coworker click from the floor opens its panel', async () => {
        mocks.answer = snapshotWith([job(11)])
        await mount()
        await act(async () => { world().onOpenCoworker('code') })
        expect(mocks.board.focusAgentOnBoard).toHaveBeenCalledWith('c1', 'logs')
        mocks.board.focusAgentOnBoard.mockReset()
        await act(async () => { world().onOpenCoworker('nobody') })
        expect(mocks.board.focusAgentOnBoard).not.toHaveBeenCalled()
        mocks.answer = snapshotWith([job(11)], [{ name: 'code', runs: 1, out: 0 }])
        await remount()
        await act(async () => { world().onOpenCoworker('code') })
        expect(mocks.board.focusAgentOnBoard).not.toHaveBeenCalled()
    })

    it('Talk to Boss opens the chat of the coworker named boss, and is disabled when there is none', async () => {
        await mount()
        const none = byText('button', 'Talk to Boss') as HTMLButtonElement
        expect(none.disabled).toBe(true)
        expect(none.title).not.toBe('')
        mocks.board.agents = [{ id: 'a1', name: 'Other' }, { id: 'b1', name: 'x', handle: 'Boss' }]
        await remount()
        const btn = byText('button', 'Talk to Boss') as HTMLButtonElement
        expect(btn.disabled).toBe(false)
        await click(btn)
        expect(mocks.board.focusAgentOnBoard).toHaveBeenCalledWith('b1', 'chat')
    })

    it('Open on a run opens that coworker on its logs', async () => {
        const run = { stage: 'build', coworkerId: 'c1', status: 'ok', startedAt: iso(NOW - 60_000), endedAt: iso(NOW - 30_000), tokensIn: 1, tokensOut: 2, runId: null }
        mocks.answer = snapshotWith([job(11, { runs: [run] })])
        await mount()
        await act(async () => { world().onSelectJob(11) })
        await click(byText('button', 'Open'))
        expect(mocks.board.focusAgentOnBoard).toHaveBeenCalledWith('c1', 'logs')
    })

    it('the column collapses to a rail and opens again', async () => {
        await mount()
        expect(host.querySelector('[data-column]')).not.toBeNull()
        await click(host.querySelector('[data-collapse]')!)
        expect(host.querySelector('[data-column]')).toBeNull()
        expect(host.querySelector('[data-rail]')).not.toBeNull()
        await click(host.querySelector('[data-rail]')!)
        expect(host.querySelector('[data-column]')).not.toBeNull()
    })
})
