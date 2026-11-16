// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StatsPoint } from '@rerun/contracts'
import { StatsChart } from '@rerun/ui/monitoring'

let host: HTMLDivElement
let root: Root

const points = (first: number, second: number): StatsPoint[] => [
    { bucket: '2026-09-01', group: null, value: first, count: 10 },
    { bucket: '2026-09-02', group: null, value: second, count: 10 },
]

function trend(values: StatsPoint[], lowerIsBetter?: boolean) {
    act(() => {
        root.render(createElement(StatsChart, { dataset: 'runs', metric: 'failureRate', chartType: 'stat', points: values, lowerIsBetter }))
    })
    const arrow = Array.from(host.querySelectorAll('span')).find(span => /[▲▼]/.test(span.textContent ?? ''))
    return { text: arrow?.textContent, className: arrow?.className }
}

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

describe('StatsChart trend colour', () => {
    it('draws a rise green and a fall red by default', () => {
        expect(trend(points(0.1, 0.4))).toMatchObject({ text: expect.stringContaining('▲'), className: 'text-emerald-500' })
        expect(trend(points(0.4, 0.1))).toMatchObject({ text: expect.stringContaining('▼'), className: 'text-rose-500' })
    })

    it('draws a rise red and a fall green when lower is better', () => {
        expect(trend(points(0.1, 0.4), true)).toMatchObject({ text: expect.stringContaining('▲'), className: 'text-rose-500' })
        expect(trend(points(0.4, 0.1), true)).toMatchObject({ text: expect.stringContaining('▼'), className: 'text-emerald-500' })
    })

    it('does not draw an unchanged rate red when lower is better', () => {
        expect(trend(points(0.2, 0.2), true)).toMatchObject({ text: expect.stringContaining('0%'), className: 'text-emerald-500' })
    })
})
