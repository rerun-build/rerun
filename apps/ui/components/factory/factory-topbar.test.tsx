// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { factorySnapshotSchema, type FactoryJob, type FactorySnapshot } from '@rerun/contracts'
import { FactoryTopBar } from './FactoryTopBar'
import { SAMPLE_TEXT } from './FactoryTasks'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const sample = () => factorySnapshotSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json'), 'utf8')))

const job = (issue: number, over: Partial<FactoryJob> = {}): FactoryJob => ({
    issue, title: `Task ${issue}`, state: 'waiting', enteredAt: new Date().toISOString(), pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: 1, dependsOn: [], reason: null, ...over,
})
const snapshot = (): FactorySnapshot => ({
    ...sample(),
    epics: [{ issue: 1, title: 'Epic one', kind: 'feature' }],
    jobs: [
        job(11, { state: 'building', department: 'engine' }),
        job(12, { state: 'waiting' }),
        job(13, { state: 'blocked', reason: 'no key' }),
        job(14, { state: 'merged' }),
    ],
})

let host: HTMLDivElement
let root: Root
const q = (s: string) => host.querySelector(s) as HTMLElement | null
const chip = (name: string) => host.querySelector(`[data-chip="${name}"]`) as HTMLElement | null
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const render = (over: Record<string, unknown> = {}) => act(() => {
    root.render(createElement(FactoryTopBar, { snapshot: snapshot(), selected: null, onSelect: () => {}, names: {}, onOpenCoworker: () => {}, ...over } as never))
})

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('FactoryTopBar', () => {
    it('collapsed: one row of four chips with counts and no panel', () => {
        render()
        expect(Array.from(host.querySelectorAll('[data-chip]')).map(c => c.textContent)).toEqual(['Running 1', 'Waiting 1', 'Problems 1', 'Done today 1'])
        expect(q('[data-dropdown]')).toBeNull()
        expect(chip('running')?.getAttribute('aria-pressed')).toBe('false')
    })

    it('a chip drops the ledger down filtered to it, and again closes it', async () => {
        render()
        await click(chip('problems'))
        expect(chip('problems')?.getAttribute('aria-pressed')).toBe('true')
        expect(q('[data-dropdown]')).not.toBeNull()
        expect(q('[data-task="13"]')).not.toBeNull()
        expect(q('[data-task="11"]')).toBeNull()
        await click(chip('problems'))
        expect(q('[data-dropdown]')).toBeNull()
    })

    it('the dropped chip row adds This wave and the departments', async () => {
        render()
        await click(chip('running'))
        const dd = q('[data-dropdown]')!
        expect(dd.querySelector('[data-chip="wave"]')?.textContent).toBe('This wave')
        expect(dd.querySelector('[data-chip="engine"]')).not.toBeNull()
    })

    it('selecting a task drops its card down instead of the ledger', async () => {
        const onSelect = vi.fn()
        render({ onSelect })
        await click(chip('running'))
        await click(q('[data-task="11"]'))
        expect(onSelect).toHaveBeenCalledWith(11)
        render({ onSelect, selected: 11 })
        expect(q('[data-dropdown]')?.textContent).toContain('Task 11')
        expect(q('[data-task="12"]')).toBeNull()
        const back = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Back to the list')!
        await click(back)
        expect(onSelect).toHaveBeenLastCalledWith(null)
    })

    it("scrolls inside: the panel's maxHeight is the --factory-drop-max variable", async () => {
        render()
        await click(chip('running'))
        expect(q('[data-dropdown]')?.style.maxHeight).toBe('var(--factory-drop-max)')
        expect(q('[data-dropdown]')?.className).toContain('overflow-y-auto')
    })

    it('a pointerdown outside slides it up and clears the selection, one inside does not', async () => {
        const onSelect = vi.fn()
        render({ onSelect })
        await click(chip('running'))
        await act(async () => { q('[data-dropdown]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
        expect(q('[data-dropdown]')).not.toBeNull()
        expect(onSelect).not.toHaveBeenCalled()
        await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
        expect(q('[data-dropdown]')).toBeNull()
        expect(onSelect).toHaveBeenCalledWith(null)
    })

    it('an opened bucket drops the list of its jobs down, a row asks for the card, and a press outside or on a chip leaves the bucket', async () => {
        const onSelect = vi.fn()
        const onBucket = vi.fn()
        const s = snapshot()
        render({ bucket: 'rejects', onSelect, onBucket, snapshot: { ...s, jobs: [...s.jobs, job(15, { state: 'rejected', reason: 'tests missing' })] } })
        expect(q('[data-bucket-row="15"]')!.textContent).toContain('tests missing')
        expect(q('[data-task="11"]')).toBeNull()
        await click(q('[data-bucket-open="15"]'))
        expect(onSelect).toHaveBeenCalledWith(15)
        await click(chip('running'))
        expect(onBucket).toHaveBeenLastCalledWith(null)
        onBucket.mockClear()
        await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
        expect(onBucket).toHaveBeenCalledWith(null)
    })

    it('with no snapshot says it is the sample and has no chips', () => {
        render({ snapshot: null })
        expect(host.textContent).toContain(SAMPLE_TEXT)
        expect(q('[data-chip]')).toBeNull()
    })
})
