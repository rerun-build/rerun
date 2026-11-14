// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryJob, FactorySnapshot } from '@rerun/contracts'
import { FactoryLedger } from './FactoryLedger'
import { buildLedger } from './factory-ledger'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const job = (issue: number, over: Partial<FactoryJob> = {}): FactoryJob => ({
    issue, title: `T${issue}`, state: 'waiting', enteredAt: new Date(NOW - 60_000).toISOString(), pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: 1, dependsOn: [], reason: null, ...over,
})
const epics = (jobs: FactoryJob[], list: FactorySnapshot['epics'] = [{ issue: 1, title: 'Epic one', kind: 'review_fix' }]) =>
    buildLedger({ version: 1, madeAt: new Date(NOW).toISOString(), beat: 1, repo: 'o/r', jobs, epics: list, holds: [], pools: [], endedToday: { merged: 0, rejected: 0, blocked: 0, failed: 0, returned: 0 } })

let host: HTMLDivElement
let root: Root
const render = (e: ReturnType<typeof epics>, selected: number | null = null, onSelect: (n: number) => void = () => {}) =>
    act(() => { root.render(createElement(FactoryLedger, { epics: e, selected, onSelect, now: NOW })) })
const q = (s: string) => host.querySelector(s) as HTMLElement | null
const text = () => host.textContent ?? ''

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe('FactoryLedger', () => {
    it('draws epic, layer and task in that order with kind, progress, state, holder, needs and department tags', () => {
        render(epics([job(10, { state: 'merged' }), job(11, { state: 'building', coworker: 'ada', dependsOn: [10, 12], department: 'engine', departments: ['docs'] }), job(12)]))
        const order = Array.from(host.querySelectorAll('[data-epic],[data-layer],[data-task]')).map((el) => el.getAttribute('data-epic') ? 'epic' : el.getAttribute('data-layer') ? 'layer' : 'task')
        expect(order).toEqual(['epic', 'layer', 'task', 'task', 'layer', 'task'])
        expect(text()).toContain('Epic one')
        expect(text()).toContain('review + fix')
        expect(q('[data-epic]')!.textContent).toContain('1 / 3')
        const t = q('[data-task="11"]')!
        expect(t.tagName).toBe('BUTTON')
        expect(t.textContent).toContain('#11 T11')
        expect(t.textContent).toContain('ada')
        expect(t.textContent).toContain('needs #12')
        expect(t.textContent).not.toContain('needs #10')
        expect(t.textContent).toContain('Engine')
        expect(t.textContent).toContain('Docs')
        expect(q('[data-task="10"]')!.textContent).not.toContain('needs')
        expect(t.querySelector('svg')).not.toBeNull()
    })

    it('draws No epic last', () => {
        render(epics([job(10), job(11, { parent: null })]))
        const heads = Array.from(host.querySelectorAll('[data-epic]')).map((e) => e.querySelector('header')!.textContent)
        expect(heads[0]).toContain('Epic one')
        expect(heads[1]).toContain('No epic')
    })

    it('lights the critical path', () => {
        render(epics([job(10), job(11, { dependsOn: [10] }), job(12)]))
        expect(q('[data-task="10"]')!.hasAttribute('data-critical')).toBe(true)
        expect(q('[data-task="11"]')!.hasAttribute('data-critical')).toBe(true)
        expect(q('[data-task="12"]')!.hasAttribute('data-critical')).toBe(false)
    })

    it('selecting lights what a task waits on and what waits on it, and marks a stuck chain', () => {
        render(epics([job(10, { state: 'failed' }), job(11, { dependsOn: [10] }), job(12, { dependsOn: [11] }), job(13)]), 11)
        expect(q('[data-task="10"]')!.getAttribute('data-chain')).toBe('waits')
        expect(q('[data-task="12"]')!.getAttribute('data-chain')).toBe('waited')
        expect(q('[data-task="13"]')!.hasAttribute('data-chain')).toBe(false)
        expect(q('[data-task="10"]')!.hasAttribute('data-stuck')).toBe(true)
        expect(q('[data-task="11"]')!.hasAttribute('data-stuck')).toBe(true)
        expect(q('[data-task="12"]')!.hasAttribute('data-stuck')).toBe(true)
        expect(q('[data-task="13"]')!.hasAttribute('data-stuck')).toBe(false)
    })

    it('draws a cycle as an alert row', () => {
        render(epics([job(10, { dependsOn: [11] }), job(11, { dependsOn: [10] }), job(12, { dependsOn: [10] })]))
        const a = q('[role="alert"]')!
        expect(a.hasAttribute('data-cycle')).toBe(true)
        expect(a.textContent).toContain('Cycle: #10, #11')
        expect(a.querySelectorAll('[data-task]').length).toBe(3)
    })

    it('a click on a row selects it and the fold opens its subtasks without selecting', () => {
        const onSelect = vi.fn()
        const at = new Date(NOW - 60_000).toISOString()
        render(epics([job(10, { runs: [{ stage: 'build', coworkerId: 'ada', status: 'done', startedAt: at, endedAt: null, tokensIn: 5, tokensOut: 6, runId: null }], steps: 3 })]), null, onSelect)
        expect(host.querySelectorAll('[data-subtasks]').length).toBe(0)
        act(() => { q('[data-task="10"]')!.click() })
        expect(onSelect).toHaveBeenCalledWith(10)
        onSelect.mockClear()
        act(() => { (host.querySelector('button[aria-label="Subtasks of #10"]') as HTMLElement).click() })
        expect(onSelect).not.toHaveBeenCalled()
        const lines = host.querySelectorAll('[data-subtasks]')
        expect(lines.length).toBe(1)
        expect(lines[0].textContent).toContain('build')
        expect(lines[0].textContent).toContain('ada')
        expect(lines[0].textContent).toContain('3 steps')
        expect(lines[0].textContent).toContain('11 tokens')
    })

    it('says No tasks when there is nothing', () => {
        render([])
        expect(text()).toBe('No tasks')
    })
})
