// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tile } from '@moldwright/ui/iso-grid'

import { TooltipProvider } from '@/components/ui/tooltip'
import { FactoryWorld } from './FactoryWorld'
import { layoutStorageKey } from './factory-layout'
import { factoryScene } from './factory-scene'

const probe = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('@moldwright/ui/iso-grid', async importOriginal => {
    const mod = await importOriginal<typeof import('@moldwright/ui/iso-grid')>()
    return { ...mod, IsoGrid: (props: Record<string, unknown>) => { probe.props = props; return null } }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mount = async () => {
    const el = document.createElement('div')
    const root = createRoot(el)
    await act(async () => { root.render(<TooltipProvider><FactoryWorld /></TooltipProvider>) })
    return () => act(() => root.unmount())
}
const area = (t: Tile) => ({ c: t.position.col, r: t.position.row, s: t.span ?? 2 })
const overlap = (a: Tile, b: Tile) => {
    const x = area(a), y = area(b)
    return x.c < y.c + y.s && y.c < x.c + x.s && x.r < y.r + y.s && y.r < x.r + x.s
}

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() })

afterEach(() => { store.clear(); probe.props = null })

describe('FactoryWorld drop wiring', () => {
    it('gives the board a drop check that says why', async () => {
        const unmount = await mount()
        const { canDropTile, tiles } = probe.props as unknown as { canDropTile: (id: string, cell: { col: number; row: number }, box: null) => string | null; tiles: Tile[] }
        const frame = factoryScene(0, 0)
        expect(canDropTile('rejects', { col: 1000, row: 1000 }, null)).toBe('outside every box')
        const bruce = tiles.find(t => t.id === 'BRUCE')!
        expect(canDropTile('rejects', bruce.position, null)).toBe('another object is here')
        const box = frame.containers[0]
        let free: { col: number; row: number } | null = null
        for (let col = box.col_start; col <= box.col_end - 1 && !free; col++) {
            for (let row = box.row_start; row <= box.row_end - 1 && !free; row++) {
                if (canDropTile('rejects', { col, row }, null) === null) free = { col, row }
            }
        }
        expect(free).not.toBeNull()
        const probeTile = { id: 'x', position: free!, span: 2 } as Tile
        expect(tiles.some(t => t.id !== 'rejects' && overlap(t, probeTile))).toBe(false)
        await unmount()
    })

    it('places the copies around their coworker on the board', async () => {
        const unmount = await mount()
        const tiles = probe.props!.tiles as Tile[]
        const boxes = probe.props!.containers as { col_start: number; col_end: number; row_start: number; row_end: number }[]
        for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
            if (tiles[i].id.startsWith('code-copy-') || tiles[j].id.startsWith('code-copy-')) expect(overlap(tiles[i], tiles[j]), `${tiles[i].id} / ${tiles[j].id}`).toBe(false)
        }
        for (const t of tiles.filter(t => t.id.startsWith('code-copy-'))) {
            expect(boxes.some(b => t.position.col >= b.col_start && t.position.col <= b.col_end && t.position.row >= b.row_start && t.position.row <= b.row_end)).toBe(true)
        }
        await unmount()
    })

    it('still refuses a stored layout that does not hold', async () => {
        localStorage.setItem(layoutStorageKey('sample'), JSON.stringify({ Delegator: { col: 1000000000, row: 0 } }))
        const unmount = await mount()
        const def = factoryScene(0, 0).tiles.find(t => t.id === 'Delegator')!
        const got = (probe.props!.tiles as Tile[]).find(t => t.id === 'Delegator')!
        expect(got.position).toEqual(def.position)
        await unmount()
    })

    it('renders the sample loop with its bar', () => {
        const html = renderToStaticMarkup(<TooltipProvider><FactoryWorld /></TooltipProvider>)
        expect(html).toContain('Factory')
    })
})
