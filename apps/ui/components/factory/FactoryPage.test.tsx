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
        selectedAgentId: null as string | null,
        hydrate: vi.fn(),
        focusAgentOnBoard: vi.fn(),
    },
    workspace: { id: 7 } as { id: number } | null,
    theme: 'dark' as string | undefined,
}))

vi.mock('@/app/api/_actions/factory.actions', () => ({ readFactorySnapshotAction: () => Promise.resolve(mocks.answer) }))
vi.mock('@/components/factory/FactoryWorld', () => ({
    FactoryWorld: (props: Record<string, unknown>) => {
        mocks.world.current = props
        return createElement('div', { 'data-world': '', 'data-selected': String(props.selectedIssue ?? '') }, props.topBar as never)
    },
}))
vi.mock('@/components/agent/AgentPanel', () => ({ AgentPanel: () => createElement('div', { 'data-agent-panel': '' }) }))
vi.mock('@/components/layout/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => createElement('div', { 'data-workspace-switcher': '' }) }))
vi.mock('@/components/control-center/ControlCenter', () => ({ ControlCenter: () => createElement('div', { 'data-control-center': '' }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: mocks.theme }) }))
vi.mock('@/stores/board.store', () => ({
    useBoardStore: Object.assign((select: (s: typeof mocks.board) => unknown) => select(mocks.board), { getState: () => mocks.board }),
}))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: mocks.workspace }) }))

import { SIDE_PANEL_GAP, loadSidePanelWidth } from '@/lib/side-panel-width'
import { FactoryPage } from './FactoryPage'

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
    mocks.theme = 'dark'
    Object.assign(mocks.board, { agents: [], hydrated: false, selectedAgentId: null })
    mocks.board.hydrate.mockReset()
    mocks.board.focusAgentOnBoard.mockReset()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe('factory page', () => {
    it('mounts the coworker panel', async () => {
        await mount()
        expect(host.querySelector('[data-agent-panel]')).not.toBeNull()
    })

    it('has no Tasks or Inspect column: no [data-column], no [data-rail]', async () => {
        await mount()
        expect(host.querySelector('[data-column]')).toBeNull()
        expect(host.querySelector('[data-rail]')).toBeNull()
        expect(byText('button', 'Tasks')).toBeUndefined()
        expect(byText('button', 'Inspect')).toBeUndefined()
    })

    it('hands FactoryWorld a topBar', async () => {
        await mount()
        expect(mocks.world.current!.topBar).toBeTruthy()
        expect(host.querySelector('[data-topbar]')).not.toBeNull()
    })

    it("the coworker panel's width becomes rightInset while a coworker is selected, 0 when none", async () => {
        window.innerWidth = 1400
        await mount()
        expect(mocks.world.current!.rightInset).toBe(0)
        mocks.board.selectedAgentId = 'c1'
        await remount()
        expect(mocks.world.current!.rightInset).toBe(loadSidePanelWidth(1400) + SIDE_PANEL_GAP)
        window.innerWidth = 600
        await act(async () => { window.dispatchEvent(new Event('resize')) })
        expect(mocks.world.current!.rightInset).toBe(0)
        window.innerWidth = 1024
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

    it('selecting a job in the dropped list selects it for the card and the floor', async () => {
        mocks.answer = snapshotWith([job(11), job(12)])
        await mount()
        await click(host.querySelector('[data-chip="running"]')!)
        await click(host.querySelector('[data-task="11"]')!)
        expect(world().selectedIssue).toBe(11)
        expect(host.querySelector('[data-world]')?.getAttribute('data-selected')).toBe('11')
        expect(host.querySelector('[data-dropdown]')?.textContent).toContain('Job 11')
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

    it('renders the corner menu and the Control Center', async () => {
        await mount()
        expect(host.querySelector('[data-workspace-switcher]')).not.toBeNull()
        expect(host.querySelector('[data-control-center]')).not.toBeNull()
    })

    it('puts Talk to Boss below the corner menu, and it still opens the chat of boss', async () => {
        mocks.board.agents = [{ id: 'b1', name: 'x', handle: 'Boss' }]
        await mount()
        const btn = byText('button', 'Talk to Boss') as HTMLButtonElement
        const cls = btn.parentElement!.classList
        expect(cls.contains('left-4')).toBe(true)
        expect(cls.contains('top-16')).toBe(true)
        expect(cls.contains('z-30')).toBe(true)
        expect(cls.contains('top-4')).toBe(false)
        await click(btn)
        expect(mocks.board.focusAgentOnBoard).toHaveBeenCalledWith('b1', 'chat')
    })

    it('hands FactoryWorld the theme: light when the theme is light, dark otherwise', async () => {
        mocks.theme = 'light'
        await mount()
        expect(mocks.world.current!.theme).toBe('light')
        mocks.theme = 'dark'
        await remount()
        expect(mocks.world.current!.theme).toBe('dark')
        mocks.theme = undefined
        await remount()
        expect(mocks.world.current!.theme).toBe('dark')
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

    it('hands the live snapshot to the floor for the bar, and null before it arrives', async () => {
        await mount()
        expect(mocks.world.current!.snapshot).toBeNull()
        mocks.answer = snapshotWith([job(1)])
        await remount()
        expect(mocks.world.current!.snapshot).toEqual((mocks.answer as { snapshot: unknown }).snapshot)
    })
})
