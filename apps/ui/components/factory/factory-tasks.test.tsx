// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { factoryJobStateSchema, type FactoryJob } from '@rerun/contracts'
import { JOB_STATE_VIEW, groupOf } from './factory-state'
import { STATUS_COLOR } from './factory-scene'
import { FactoryTasks, SAMPLE_TEXT, formatEndedAt, formatInState, isLocalToday } from './FactoryTasks'

const NOW = new Date(2026, 10, 14, 12, 0).getTime()
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
        expect(rows()).toHaveLength(2)
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

    const chipOf = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-chip]')).find((c) => c.textContent?.includes(name))!
    const at = (d: number, h: number, min: number) => new Date(2026, 10, d, h, min).toISOString()
    const earlierHeader = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find((b) => b.textContent?.includes('Earlier'))!

    it('keeps only jobs that ended on the local today in Ended today and puts older ended jobs in a collapsed Earlier group with its count', () => {
        render([
            job({ issue: 1, state: 'merged', enteredAt: at(14, 9, 5) }),
            job({ issue: 2, state: 'merged', enteredAt: at(13, 22, 10) }),
            job({ issue: 3, state: 'merged', enteredAt: at(13, 8, 30) }),
        ])
        expect(chipOf('Ended today').textContent).toContain('1')
        expect(chipOf('Earlier').textContent).toContain('2')
        expect(rows()).toHaveLength(0)
        expect(earlierHeader().getAttribute('aria-expanded')).toBe('false')
        act(() => earlierHeader().click())
        expect(earlierHeader().getAttribute('aria-expanded')).toBe('true')
        expect(rows()).toHaveLength(2)
    })

    it('chip counts follow the split and the Earlier chip filters and opens the group', () => {
        render([
            job({ issue: 1 }), job({ issue: 2, state: 'queued' }),
            job({ issue: 3, state: 'merged', enteredAt: at(14, 9, 5) }),
            job({ issue: 4, state: 'merged', enteredAt: at(12, 9, 5) }),
        ])
        expect(chipOf('Active').textContent).toContain('1')
        expect(chipOf('Waiting').textContent).toContain('1')
        expect(chipOf('Ended today').textContent).toContain('1')
        expect(chipOf('Earlier').textContent).toContain('1')
        act(() => chipOf('Earlier').click())
        expect(rows()).toHaveLength(1)
        expect(rows()[0].textContent).toContain('#4')
        expect(earlierHeader().getAttribute('aria-expanded')).toBe('true')
    })

    it('shows HH:MM for an ended job of today and Mon 19:48 style for an earlier day', () => {
        render([
            job({ issue: 1, state: 'merged', enteredAt: at(14, 9, 5) }),
            job({ issue: 2, state: 'rejected', enteredAt: at(14, 10, 6) }),
            job({ issue: 3, state: 'blocked', enteredAt: at(14, 11, 7) }),
            job({ issue: 4, state: 'failed', enteredAt: at(14, 7, 8) }),
            job({ issue: 5, state: 'returned', enteredAt: at(14, 6, 9) }),
            job({ issue: 6, state: 'merged', enteredAt: at(9, 19, 48) }),
        ])
        act(() => earlierHeader().click())
        act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find((b) => b.textContent?.includes('Ended today'))!.click())
        const cells = Array.from(host.querySelectorAll('[data-ended-at]')).map((e) => e.textContent)
        expect(cells).toEqual(['10:06', '11:07', '07:08', '06:09', '09:05', 'Mon 19:48'])
    })

    it('running rows keep the ticking time in state', () => {
        render([job({})])
        expect(host.querySelector('[data-ended-at]')).toBeNull()
        expect(rows()[0].textContent).toContain('12s')
        act(() => { vi.advanceTimersByTime(1000) })
        expect(rows()[0].textContent).toContain('13s')
    })

    it('isLocalToday and formatEndedAt around local midnight', () => {
        const now = new Date(2026, 10, 14, 0, 1).getTime()
        const before = new Date(2026, 10, 13, 23, 59).toISOString()
        const after = new Date(2026, 10, 14, 0, 1).toISOString()
        expect(isLocalToday(before, now)).toBe(false)
        expect(isLocalToday(after, now)).toBe(true)
        expect(formatEndedAt(before, now)).toBe('Fri 23:59')
        expect(formatEndedAt(after, now)).toBe('00:01')
    })

    describe('Problems pinned first, ended groups collapsed', () => {
        const chips = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-chip]')).map((c) => c.textContent)
        const group = (g: string) => host.querySelector<HTMLElement>(`section[data-group="${g}"]`)
        const heading = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find((b) => b.textContent?.includes(name))!
        const mixed = () => [
            job({ issue: 1 }), job({ issue: 2, state: 'queued' }),
            job({ issue: 3, state: 'merged', enteredAt: at(14, 9, 5) }), job({ issue: 4, state: 'merged', enteredAt: at(14, 9, 6) }),
            job({ issue: 5, state: 'blocked', reason: 'why', enteredAt: at(14, 9, 7) }), job({ issue: 6, state: 'failed', enteredAt: at(13, 9, 5) }),
            job({ issue: 7, state: 'returned', enteredAt: at(14, 8, 5) }), job({ issue: 8, state: 'rejected', enteredAt: at(12, 9, 5) }),
            job({ issue: 9, state: 'merged', enteredAt: at(11, 9, 5) }),
        ]

        it('puts a Problems chip first with the count of blocked, failed, returned and rejected jobs of any day', () => {
            render(mixed())
            expect(chips()).toEqual(['Problems 4', 'Active 1', 'Waiting 1', 'Ended today 2', 'Earlier 1'])
        })

        it('pins the problem rows above every other group, once each, with the reason under blocked', () => {
            render(mixed())
            const sections = Array.from(host.querySelectorAll<HTMLElement>('section[data-group]')).map((x) => x.dataset.group)
            expect(sections[0]).toBe('problems')
            expect(Array.from(group('problems')!.querySelectorAll('[data-row]')).map((r) => r.textContent?.match(/#(\d+)/)?.[1])).toEqual(['5', '6', '7', '8'])
            expect(group('problems')!.textContent).toContain('why')
            expect(host.querySelectorAll('[data-row]').length).toBe(6)
        })

        it('folds Ended today and Earlier by default and shows their counts on the headings', () => {
            render(mixed())
            expect(heading('Ended today').getAttribute('aria-expanded')).toBe('false')
            expect(heading('Ended today').textContent).toContain('2')
            expect(heading('Earlier').getAttribute('aria-expanded')).toBe('false')
            expect(heading('Earlier').textContent).toContain('1')
            expect(group('ended')!.querySelectorAll('[data-row]')).toHaveLength(0)
        })

        it('opens a folded group from its heading, and from its chip, which also filters to it', () => {
            render(mixed())
            act(() => heading('Ended today').click())
            expect(group('ended')!.querySelectorAll('[data-row]')).toHaveLength(2)
            act(() => heading('Ended today').click())
            expect(group('ended')!.querySelectorAll('[data-row]')).toHaveLength(0)
            act(() => chipOf('Earlier').click())
            expect(rows()).toHaveLength(1)
            expect(rows()[0].textContent).toContain('#9')
            expect(heading('Earlier').getAttribute('aria-expanded')).toBe('true')
        })

        it('leaves a job closed by hand out of Problems and shows it under Ended today as closed by hand', () => {
            render([job({ issue: 1, state: 'failed', closedOutside: true, enteredAt: at(14, 9, 5) }), job({ issue: 2, state: 'blocked', enteredAt: at(14, 9, 6) })])
            expect(chips()).toContain('Problems 1')
            expect(chips()).toContain('Ended today 1')
            act(() => heading('Ended today').click())
            expect(group('ended')!.textContent).toContain('closed by hand')
            expect(Array.from(group('problems')!.querySelectorAll('[data-row]')).map((r) => r.textContent?.match(/#(\d+)/)?.[1])).toEqual(['2'])
        })

        it('shows a closed-by-hand job of an earlier day under Earlier', () => {
            render([job({ issue: 3, state: 'returned', closedOutside: true, enteredAt: at(12, 9, 5) })])
            expect(chips()).toContain('Problems 0')
            expect(chips()).toContain('Earlier 1')
            act(() => heading('Earlier').click())
            expect(host.querySelector('[data-closed-by-hand]')).not.toBeNull()
        })

        it('the Problems chip filters to the problem rows', () => {
            render(mixed())
            act(() => chipOf('Problems').click())
            expect(rows()).toHaveLength(4)
        })
    })
})
