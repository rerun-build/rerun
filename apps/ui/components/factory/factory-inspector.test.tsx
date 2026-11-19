// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryJob } from '@moldwright/contracts'
import { FactoryInspector } from './FactoryInspector'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const job = (over: Partial<FactoryJob>): FactoryJob => ({
    issue: 12, title: 'A title', state: 'building', enteredAt: new Date(NOW - 252_000).toISOString(), pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: null, dependsOn: [], reason: null, ...over,
})

let host: HTMLDivElement
let root: Root
const render = (j: FactoryJob | null, extra: { onSelect?: (n: number) => void; onOpenCoworker?: (id: string) => void; names?: Record<string, string> } = {}) =>
    act(() => {
        root.render(createElement(FactoryInspector, {
            job: j, jobs: j ? [j] : [], repo: 'o/r', names: extra.names ?? {},
            onSelect: extra.onSelect ?? (() => {}), onOpenCoworker: extra.onOpenCoworker ?? (() => {}),
        }))
    })
const text = () => host.textContent ?? ''
const hrefs = () => Array.from(host.querySelectorAll('a')).map((a) => a.getAttribute('href'))

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

describe('FactoryInspector', () => {
    it('shows the hint when nothing is selected', () => {
        render(null)
        expect(text()).toBe('Pick a task in the list or on the floor')
    })

    it('draws the header with the issue, PR and PR files links', () => {
        render(job({ pr: 41 }))
        expect(text()).toContain('#12')
        expect(text()).toContain('A title')
        expect(hrefs()).toEqual(['https://github.com/o/r/issues/12', 'https://github.com/o/r/pull/41', 'https://github.com/o/r/pull/41/files'])
        for (const a of Array.from(host.querySelectorAll('a'))) { expect(a.getAttribute('target')).toBe('_blank'); expect(a.getAttribute('rel')).toBe('noreferrer') }
        render(job({ pr: null }))
        expect(hrefs()).toEqual(['https://github.com/o/r/issues/12'])
    })

    it('shows the facts, with n/a for null tokens', () => {
        render(job({ coworker: 'code', copy: 3, round: 2, steps: 7, tokensIn: 100, tokensOut: null, parent: 5 }))
        expect(text()).toContain('code · 3')
        expect(text()).toContain('4m 12s')
        expect(text()).toContain('#5')
        expect(text()).toContain('n/a')
        expect(text()).toContain('100')
    })

    it('a depends-on chip selects that job', () => {
        const onSelect = vi.fn()
        render(job({ dependsOn: [9, 10] }), { onSelect })
        const chip = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('#9'))!
        act(() => { chip.click() })
        expect(onSelect).toHaveBeenCalledWith(9)
    })

    it('lists the history newest first with state and reason', () => {
        const at = (s: number) => new Date(NOW - s * 1000).toISOString()
        render(job({
            history: [
                { state: 'queued', at: at(300), reason: null, runId: null },
                { state: 'building', at: at(200), reason: 'picked up', runId: null },
            ],
        }))
        const t = text()
        expect(t.indexOf('building')).toBeLessThan(t.indexOf('queued'))
        expect(t).toContain('picked up')
        expect(t).toMatch(/\d\d:\d\d:\d\d/)
        expect(t).not.toContain('No earlier history')
    })

    it('lists the runs newest first and Open calls onOpenCoworker with the coworker id', () => {
        const onOpen = vi.fn()
        const run = (stage: string, coworkerId: string, startedAt: string, endedAt: string | null) =>
            ({ stage, coworkerId, status: 'done', startedAt, endedAt, tokensIn: 1, tokensOut: 2, runId: null })
        render(job({
            runs: [
                run('build', 'abc', '2026-11-14T10:00:00Z', '2026-11-14T10:30:00Z'),
                run('review', 'xyz', '2026-11-14T11:00:00Z', null),
            ],
        }), { onOpenCoworker: onOpen, names: { abc: 'code' } })
        const t = text()
        expect(t.indexOf('review ·')).toBeLessThan(t.indexOf('build ·'))
        expect(t).toContain('code')
        expect(t).toContain('xyz')
        expect(t).toContain('running')
        const opens = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === 'Open')
        expect(opens).toHaveLength(2)
        act(() => { opens[1].click() })
        expect(onOpen).toHaveBeenCalledWith('abc')
    })

    it('shows what it has when history and runs are absent', () => {
        render(job({ state: 'queued' }))
        expect(text()).toContain('queued')
        expect(text()).toContain('No earlier history from the delegator yet')
        expect(text()).toContain('No runs recorded yet')
    })

    it('ticks the time in state each second', () => {
        render(job({}))
        expect(text()).toContain('4m 12s')
        act(() => { vi.advanceTimersByTime(3000) })
        expect(text()).toContain('4m 15s')
    })
})
