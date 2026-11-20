// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TileBlock, type TileCountdown } from '@rerun/ui/iso-grid'
// Not exported by the kit: IsoGrid draws it over the hovered tile.
import { TileResultsCard } from '../../../../packages/ui/src/iso-grid/components/TileResultsCard'
import { tileFromAgent } from './iso-adapter'
import type { IsoAgent } from './types'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
})

const agent: IsoAgent = { id: 'a1', name: 'Support', handle: 'support', description: null, templateId: null, status: 'idle', position: { col: 2, row: 2 }, workspaceId: 1, spaceId: 's1', disabledAt: null, disabledReason: null }
// The checkered flag is painted in RESULTS_GREEN (#34d399), which the DOM may hand back as rgb().
const GREEN_FLAG = /#34d399|rgb\(52, 211, 153\)/i
const RESULTS = { count: 249, items: [{ label: 'Reply to a ticket', count: 249, at: Date.UTC(2026, 10, 20) }] }

const IN_TWO_HOURS: TileCountdown = { at: Date.now() + 2 * 3_600_000 }

async function renderTile(overrides: Partial<IsoAgent>, results: typeof RESULTS | null = RESULTS, nextRun: TileCountdown | null = null) {
    const tile = tileFromAgent({ ...agent, ...overrides }, false, 1, 'live', nextRun, results)
    await act(async () => root.render(createElement(TileBlock, { tile, selected: false, hovered: false, isDragging: false, worldOffset: { left: 0, top: 0 }, onSelect: () => {} })))
    // The countdown reads its clock once mounted, on the next tick.
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
    const flag = [...container.querySelectorAll('svg')].find(icon => GREEN_FLAG.test(icon.getAttribute('style') ?? ''))
    const hands = container.querySelectorAll('.text-cyan-400')
    return { pill: flag?.closest('.iso-buddy-label') ?? null, hands, flagged: !!flag }
}

describe('the green pill of what a coworker finished', () => {
    it('sits above a resting coworker, with no hand', async () => {
        const { flagged, hands } = await renderTile({ status: 'idle' })
        expect(flagged).toBe(true)
        expect(hands).toHaveLength(0)
    })

    it('stays above a coworker waiting on the member, with the hand inside it', async () => {
        const { pill, flagged, hands } = await renderTile({ status: 'waiting_human' })
        expect(flagged).toBe(true)
        expect(hands).toHaveLength(1)
        expect(pill?.contains(hands[0])).toBe(true)
    })

    it('keeps the next run off a coworker waiting on the member, as before', async () => {
        const resting = await renderTile({ status: 'idle' }, RESULTS, IN_TWO_HOURS)
        expect(resting.pill?.textContent).toBe('99+2h')
        const waiting = await renderTile({ status: 'waiting_human' }, RESULTS, IN_TWO_HOURS)
        expect(waiting.pill?.textContent).toBe('99+')
    })

    it('leaves the hand alone when the waiting coworker has nothing new', async () => {
        const { pill, hands } = await renderTile({ status: 'waiting_human' }, null)
        expect(pill).toBeNull()
        expect(hands).toHaveLength(1)
    })

    it('is not drawn on a switched-off coworker', async () => {
        const { pill } = await renderTile({ disabledAt: '2026-11-19T10:00:00.000Z' })
        expect(pill).toBeNull()
    })
})

describe('the list of what a coworker finished, on hover', () => {
    async function renderCard(overrides: Partial<IsoAgent>) {
        const tile = tileFromAgent({ ...agent, ...overrides }, false, 1, 'live', null, RESULTS)
        await act(async () => root.render(createElement(TileResultsCard, { tile, worldOffset: { left: 0, top: 0 }, reducedMotion: true })))
        return container.textContent ?? ''
    }

    it('opens over a coworker waiting on the member', async () => {
        expect(await renderCard({ status: 'waiting_human' })).toContain('Reply to a ticket')
    })

    it('stays shut over a switched-off coworker', async () => {
        expect(await renderCard({ disabledAt: '2026-11-19T10:00:00.000Z' })).toBe('')
    })
})
