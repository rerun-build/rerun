// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routeTileLinks } from '@moldwright/ui/iso-grid'
import type { FactoryJob } from '@moldwright/contracts'
import { FactoryBucket } from './FactoryBucket'
import { FactoryOverlay } from './FactoryOverlay'
import { bucketJobs, bucketRow } from './factory-bucket'
import { factoryScene } from './factory-scene'

const job = (issue: number, over: Partial<FactoryJob> = {}): FactoryJob => ({
    issue, title: `Task ${issue}`, state: 'waiting', enteredAt: '2026-11-16T10:00:00Z', pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: null, dependsOn: [], reason: null, ...over,
})
const run = (stage: string, coworkerId: string, startedAt: string) => ({ stage, coworkerId, status: 'done', startedAt, endedAt: startedAt, tokensIn: 1, tokensOut: 1, runId: null })
const NAMES = { 'code-1': 'code', 'linus-1': 'LINUS', 'bruce-1': 'BRUCE' }
const JOBS = [
    job(11, { state: 'rejected', parent: 5, pr: 90, reason: 'review round 2: tests missing', runs: [run('build', 'code-1', '2026-11-16T09:00:00Z'), run('review', 'linus-1', '2026-11-16T09:10:00Z'), run('fix', 'code-1', '2026-11-16T09:20:00Z'), run('review', 'linus-1', '2026-11-16T09:30:00Z')] }),
    job(12, { state: 'unsolvable', reason: 'failed twice on another model', runs: [run('proof', 'bruce-1', '2026-11-16T09:40:00Z'), run('senior', 'code-1', '2026-11-16T09:35:00Z')] }),
    job(13, { state: 'merged', parent: 5, pr: 91 }),
    job(14, { state: 'building', parent: 5 }),
    job(15, { state: 'rejected' }),
]

describe('what a bucket holds', () => {
    it('the reject bin holds the jobs ended rejected or unsolvable and no other', () => {
        expect(bucketJobs(JOBS, 'rejects').map(j => j.issue)).toEqual([11, 12, 15])
    })

    it('a feature tank holds every task of that feature', () => {
        expect(bucketJobs(JOBS, 5).map(j => j.issue)).toEqual([11, 13, 14])
    })

    it('names the station and coworker that ended a job and the builder whose work it was, from its runs', () => {
        expect(bucketRow(JOBS[0], NAMES)).toMatchObject({ station: 'review', by: 'LINUS', builder: 'code' })
        expect(bucketRow(JOBS[1], NAMES)).toMatchObject({ station: 'proof', by: 'BRUCE', builder: 'code' })
    })

    it('reads the station from the first word of a stage as the dispatcher writes it', () => {
        const live = { ...JOBS[0], runs: [run('build', 'code-1', '2026-11-16T09:00:00Z'), run('review 1 of #1139 at', 'linus-1', '2026-11-16T09:10:00Z'), run('fix of #1139', 'larry-1', '2026-11-16T09:20:00Z'), run('proof of #1139 at 67', 'bruce-1', '2026-11-16T09:30:00Z')] }
        expect(bucketRow(live, NAMES)).toMatchObject({ station: 'proof', by: 'BRUCE', builder: 'larry-1' })
    })

    it('leaves station, coworker and builder empty for a job without runs, and the station empty for a job that was not rejected', () => {
        expect(bucketRow(JOBS[4], NAMES)).toMatchObject({ station: null, by: null, builder: null })
        expect(bucketRow({ ...JOBS[0], state: 'merged' }, NAMES)).toMatchObject({ station: null, by: null, builder: 'code' })
    })
})

let host: HTMLDivElement
let root: Root
const q = (s: string) => host.querySelector(s) as HTMLElement | null
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the list behind a bucket', () => {
    const show = (over: Record<string, unknown> = {}) => act(() => {
        root.render(createElement(FactoryBucket, { bucket: 'rejects', jobs: JOBS, repo: 'acme/app', names: NAMES, now: Date.parse('2026-11-16T12:00:00Z'), onSelect: () => {}, ...over } as never))
    })

    it('lists each rejected job with its title, who rejected it where, the reason, the time, the builder and its links', () => {
        show()
        const row = q('[data-bucket-row="11"]')!
        expect(row.textContent).toContain('#11 Task 11')
        expect(row.textContent).toContain('rejected at review by LINUS')
        expect(row.textContent).toContain('built by code')
        expect(row.textContent).toContain('review round 2: tests missing')
        expect(row.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-16T10:00:00Z')
        expect(row.querySelector('a[aria-label="Issue 11"]')?.getAttribute('href')).toBe('https://github.com/acme/app/issues/11')
        expect(row.querySelector('a[aria-label="PR 90"]')?.getAttribute('href')).toBe('https://github.com/acme/app/pull/90')
        expect(q('[data-bucket-row="12"]')!.textContent).toContain('unsolvable at proof by BRUCE')
    })

    it('says so when the reason, the station or the builder was not recorded, and shows no pull request link without one', () => {
        show()
        const row = q('[data-bucket-row="15"]')!
        expect(row.textContent).toContain('No reason recorded')
        expect(row.textContent).toContain('station not recorded')
        expect(row.textContent).toContain('builder not recorded')
        expect(row.querySelector('a[aria-label^="PR"]')).toBeNull()
    })

    it('a row opens the detail of its job', async () => {
        const onSelect = vi.fn()
        show({ onSelect })
        await click(q('[data-bucket-open="11"]'))
        expect(onSelect).toHaveBeenCalledWith(11)
    })

    it('a feature tank lists its tasks with the count the tank shows', () => {
        show({ bucket: 5 })
        expect(q('[data-bucket-title]')!.textContent).toBe('Feature #5: 1 merged, 1 rejected, 3 tasks')
        expect(Array.from(host.querySelectorAll('[data-bucket-row]')).map(r => r.getAttribute('data-bucket-row'))).toEqual(['11', '13', '14'])
    })

    it('an empty bucket says it is empty', () => {
        show({ jobs: [] })
        expect(q('[data-bucket-title]')!.textContent).toBe('Rejected jobs: 0')
        expect(host.textContent).toContain('No job in this bucket')
    })
})

describe('a bucket on the floor', () => {
    it('one click on the reject bin or on a feature tank asks for its list', async () => {
        const frame = factoryScene(6_000, 0)
        const onOpenBucket = vi.fn()
        act(() => {
            root.render(createElement(FactoryOverlay, { tiles: frame.tiles, routes: routeTileLinks(frame.tiles, frame.links), pods: [], cabinets: frame.cabinets, rejects: frame.rejects, held: false, onOpenBucket } as never))
        })
        const bin = q('[data-tank="rejects"]')!
        expect(bin.getAttribute('role')).toBe('button')
        await click(bin)
        expect(onOpenBucket).toHaveBeenLastCalledWith('rejects')
        await click(q('[data-tank="feature"]'))
        expect(onOpenBucket).toHaveBeenLastCalledWith(frame.cabinets[0].issue)
    })
})
