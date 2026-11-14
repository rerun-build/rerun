// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { factoryJobStateSchema, type FactoryJob } from '@rerun/contracts'
import { JOB_STATE_VIEW, groupOf } from './factory-state'
import { STATUS_COLOR } from './factory-scene'
import { FactoryTasks, SAMPLE_TEXT, formatInState } from './FactoryTasks'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const ended = { merged: 23, rejected: 0, blocked: 0, failed: 0, returned: 0 }
const job = (over: Partial<FactoryJob>): FactoryJob => ({
    issue: 1, title: 'A title', state: 'building', enteredAt: new Date(NOW - 12_000).toISOString(), pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: null, dependsOn: [], reason: null, ...over,
})

let host: HTMLDivElement
let root: Root
const render = (jobs: FactoryJob[], selected: number | null = null, onSelect: (n: number) => void = () => {}) =>
    act(() => { root.render(createElement(FactoryTasks, { jobs, repo: 'o/r', endedToday: ended, selected, onSelect })) })
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[data-row]'))

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
})

describe('FactoryTasks', () => {
    it('maps every one of the 13 states to an icon and a colour', () => {
        expect(Object.keys(JOB_STATE_VIEW).sort()).toEqual([...factoryJobStateSchema.options].sort())
        for (const v of Object.values(JOB_STATE_VIEW)) { expect(v.icon).toBeTruthy(); expect(v.color).toMatch(/^#/) }
        expect(JOB_STATE_VIEW.building.color).toBe(STATUS_COLOR.build)
        expect(JOB_STATE_VIEW.reviewing.color).toBe(STATUS_COLOR.review)
        expect(JOB_STATE_VIEW.merged.color).toBe(STATUS_COLOR.complete)
        expect(JOB_STATE_VIEW.rejected.color).toBe(STATUS_COLOR.rejected)
        expect(JOB_STATE_VIEW.waiting.dim).toBe(true)
    })

    it('groups the jobs as Active, Waiting and Ended today', () => {
        for (const s of ['building', 'review_wait', 'reviewing', 'fix_wait', 'fixing', 'checks'] as const) expect(groupOf(s)).toBe('active')
        for (const s of ['waiting', 'queued'] as const) expect(groupOf(s)).toBe('waiting')
        for (const s of ['merged', 'rejected', 'blocked', 'failed', 'returned'] as const) expect(groupOf(s)).toBe('ended')
    })

    it('draws a row with issue, title, coworker and copy, round badge and PR link', () => {
        render([job({ issue: 41, title: 'Fix it', coworker: 'code', copy: 3, pr: 41, round: 2 }), job({ issue: 42, round: 1 })])
        const [a, b] = rows()
        expect(a.textContent).toContain('#41')
        expect(a.textContent).toContain('Fix it')
        expect(a.textContent).toContain('code · 3')
        expect(a.textContent).toContain('R2')
        expect(a.querySelector('a')?.getAttribute('href')).toBe('https://github.com/o/r/pull/41')
        expect(b.textContent).not.toContain('R1')
        expect(b.querySelector('a')).toBeNull()
    })

    it('shows the reason under blocked, failed and returned jobs only', () => {
        render([
            job({ issue: 1, state: 'blocked', reason: 'why-blocked' }), job({ issue: 2, state: 'failed', reason: 'why-failed' }),
            job({ issue: 3, state: 'returned', reason: 'why-returned' }), job({ issue: 4, state: 'building', reason: 'why-building' }),
            job({ issue: 5, state: 'failed', reason: null }),
        ])
        const t = host.textContent ?? ''
        expect(t).toContain('why-blocked'); expect(t).toContain('why-failed'); expect(t).toContain('why-returned')
        expect(t).not.toContain('why-building')
    })

    it('formats the time in state and ticks each second', () => {
        expect(formatInState(12_000)).toBe('12s')
        expect(formatInState(252_000)).toBe('4m 12s')
        expect(formatInState(3_900_000)).toBe('1h 05m')
        render([job({})])
        expect(rows()[0].textContent).toContain('12s')
        act(() => { vi.advanceTimersByTime(1000) })
        expect(rows()[0].textContent).toContain('13s')
    })

    it('filters by group with counts and clears on a second click', () => {
        render([job({ issue: 1 }), job({ issue: 2, state: 'queued' }), job({ issue: 3, state: 'merged' })])
        const chip = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-chip]')).find((c) => c.textContent?.includes(name))!
        expect(chip('Waiting').textContent).toContain('1')
        act(() => chip('Waiting').click())
        expect(rows()).toHaveLength(1)
        expect(rows()[0].textContent).toContain('#2')
        act(() => chip('Waiting').click())
        expect(rows()).toHaveLength(3)
    })

    it('says the line is idle with the merged count', () => {
        render([job({ state: 'merged' })])
        expect(host.textContent).toContain('The line is idle. 23 merged today.')
    })

    it('says it is the sample floor, not an idle line, when there is no live data', () => {
        act(() => { root.render(createElement(FactoryTasks, { jobs: [], repo: '', endedToday: ended, selected: null, onSelect: () => {}, sample: true })) })
        expect(host.textContent).toContain(SAMPLE_TEXT)
        expect(host.textContent).not.toContain('The line is idle')
    })

    it('calls onSelect with the issue on a row click, and not on the PR link click', () => {
        const onSelect = vi.fn()
        render([job({ issue: 7, pr: 9 })], null, onSelect)
        act(() => rows()[0].click())
        expect(onSelect).toHaveBeenCalledWith(7)
        onSelect.mockClear()
        const link = rows()[0].querySelector('a')!
        link.addEventListener('click', (e) => e.preventDefault())
        act(() => link.click())
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('highlights the selected row', () => {
        render([job({ issue: 1 }), job({ issue: 2 })], 2)
        const [a, b] = rows()
        expect(a.getAttribute('aria-pressed')).toBe('false')
        expect(b.getAttribute('aria-pressed')).toBe('true')
    })
})
