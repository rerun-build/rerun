// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatsMetric, StatsPoint, StatsQuery } from '@rerun/contracts'

const values = vi.hoisted(() => ({ current: {} as Partial<Record<StatsMetric, number>> }))

vi.mock('@/app/api/_actions/agent.actions', () => ({
    readAgentMonitoringAction: async (_agentId: string, _range: string, queries: StatsQuery[]) => ({
        usage: [],
        stats: queries.map((query): StatsPoint[] => [{ bucket: '2026-09-01', group: null, value: values.current[query.metric] ?? 1, count: 4 }]),
    }),
}))

vi.mock('@/hooks/useVisibleInterval', async () => {
    const { useEffect } = await import('react')
    return { useVisibleInterval: (load: () => Promise<void>) => useEffect(() => void load(), [load]) }
})

vi.mock('@/components/ui/tooltip', () => {
    const pass = ({ children }: { children: ReactNode }) => children
    return {
        Tooltip: pass,
        TooltipProvider: pass,
        TooltipTrigger: pass,
        TooltipContent: ({ children }: { children: ReactNode }) => createElement('div', { 'data-tooltip': '' }, children),
    }
})

vi.mock('@rerun/ui/monitoring', () => ({
    StatsChart: (props: { metric: string; chartType: string; points: StatsPoint[] | null }) =>
        createElement('div', { 'data-chart': `${props.metric}:${props.chartType}`, 'data-points': JSON.stringify(props.points) }),
    TokenUsageChart: () => createElement('div'),
    MonitorCard: ({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) =>
        createElement('section', { 'data-card': title }, subtitle, action, children),
}))

const { AgentPanelMonitoring } = await import('./AgentPanelMonitoring')

let host: HTMLDivElement
let root: Root

async function render(next: Partial<Record<StatsMetric, number>>) {
    values.current = next
    await act(async () => {
        root.render(createElement(AgentPanelMonitoring, { agentId: 'a1' }))
    })
}

const card = (title: string) => host.querySelector<HTMLElement>(`[data-card="${title}"]`)
const charts = () => Array.from(host.querySelectorAll<HTMLElement>('[data-chart]')).map(node => node.dataset.chart)

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

describe('AgentPanelMonitoring rates', () => {
    it('shows a failure rate card beside the error rate card, each with its definition', async () => {
        await render({ errorRate: 0.1, failureRate: 0.4 })
        const titles = Array.from(host.querySelectorAll<HTMLElement>('[data-card]')).map(node => node.dataset.card)
        expect(titles.indexOf('Failure rate')).toBe(titles.indexOf('Error rate') + 1)
        expect(card('Failure rate')?.querySelector('[data-chart]')?.getAttribute('data-chart')).toBe('failureRate:stat')
        expect(card('Error rate')?.querySelector('[data-tooltip]')?.textContent).toMatch(/error/i)
        expect(card('Failure rate')?.querySelector('[data-tooltip]')?.textContent).toMatch(/BLOCKED:/)
        expect(card('Failure rate')?.querySelector('button')?.getAttribute('aria-label')).toBeTruthy()
    })

    it('draws the failure rate over time as a line', async () => {
        await render({})
        expect(charts()).toContain('failureRate:line')
        expect(card('Failure rate over time')).not.toBeNull()
    })
})

describe('AgentPanelMonitoring cost', () => {
    const tokens = { totalTokens: 1200, inputTokens: 1000, cachedInputTokens: 900, outputTokens: 200 }

    it('shows tokens by class instead of a dollar figure when the connection reports no price', async () => {
        await render({ ...tokens, cost: 0 })
        const total = card('Total cost')
        expect(total?.querySelector('[data-chart]')).toBeNull()
        expect(total?.textContent).toContain('No cost was reported')
        expect(total?.textContent).toMatch(/Fresh input\s*100/)
        expect(total?.textContent).toMatch(/Cached input\s*900/)
        expect(total?.textContent).toMatch(/Output\s*200/)
        expect(charts()).not.toContain('cost:area')
        expect(card('Cost over time')).toBeNull()
        const split = card('Tokens by class')?.querySelector<HTMLElement>('[data-chart]')
        const points = JSON.parse(split?.dataset.points ?? '[]') as StatsPoint[]
        expect(Object.fromEntries(points.map(point => [point.group, point.value]))).toEqual({ 'Fresh input': 100, 'Cached input': 900, Output: 200 })
    })

    it('keeps the dollar figure when a real cost exists', async () => {
        await render({ ...tokens, cost: 1500 })
        expect(card('Total cost')?.querySelector('[data-chart]')?.getAttribute('data-chart')).toBe('cost:stat')
        expect(card('Total cost')?.textContent).not.toContain('No cost was reported')
        expect(charts()).toContain('cost:area')
        expect(card('Tokens by class')).toBeNull()
    })
})
