// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IsoGrid, type Tile } from '@rerun/ui/iso-grid'

// The board lights the landing cell of a drag and says why a drop is refused for two seconds.

const tile = (id: string, col: number, row: number): Tile => ({ id, position: { col, row }, span: 1, style: { color: '#fff' } })
const TILES = [tile('a', 5, 5), tile('b', 8, 3)]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root

beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
})

describe('IsoGrid canDropTile', () => {
    it('draws an IsoGrid that is given canDropTile, and no hint while nothing is dragged', () => {
        act(() => root.render(createElement(IsoGrid, { tiles: TILES, containers: [{ id: 'box', label: null, color: '#336699', col_start: 0, row_start: 0, col_end: 10, row_end: 10 }], canDropTile: () => 'another object is here' })))
        expect(host.querySelector('[data-drop-hint]')).toBeNull()
        expect(host.innerHTML.length).toBeGreaterThan(0)
    })

    it('draws the old dashed ghost when canDropTile is not given', () => {
        const src = readFileSync(resolve(__dirname, '../../../../packages/ui/src/iso-grid/IsoGrid.tsx'), 'utf8')
        expect(src).toContain('strokeDasharray="4 3"')
        expect(src).toContain('canDropTile')
    })

    it('shows a refusal for two seconds after a refused drop', () => {
        const onTileMove = vi.fn()
        const onTileMoveRefused = vi.fn()
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
        }
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 })
        Element.prototype.setPointerCapture = () => {}
        Element.prototype.hasPointerCapture = () => false
        Element.prototype.releasePointerCapture = () => {}
        vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
        let attempt = 0
        const mount = () => {
            act(() => root.render(createElement(IsoGrid, { key: attempt++, tiles: TILES, containers: [], onTileMove, onTileMoveRefused, canDropTile: () => 'outside every box' } as never)))
            return host.querySelector<HTMLElement>('[role="group"]') as HTMLElement
        }
        let target = mount()
        const fire = (type: string, x: number, y: number) => act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse', pointerId: 1 })) })
        // a pointerdown on empty floor starts a pan, so each try gets a fresh board
        const hit = (() => {
            for (let y = 250; y < 550; y += 12) for (let x = 350; x < 650; x += 12) {
                target = mount()
                fire('pointerdown', x, y)
                fire('pointermove', x + 40, y + 40)
                fire('pointermove', x + 80, y + 40)
                fire('pointerup', x + 80, y + 40)
                if (onTileMoveRefused.mock.calls.length) return true
            }
            return false
        })()
        expect(hit).toBe(true)
        expect(onTileMove).not.toHaveBeenCalled()
        expect(host.querySelector('[data-drop-hint="refused"]')?.parentElement?.textContent).toContain('outside every box')
        act(() => { vi.advanceTimersByTime(1999) })
        expect(host.querySelector('[data-drop-hint="refused"]')).not.toBeNull()
        act(() => { vi.advanceTimersByTime(2) })
        expect(host.querySelector('[data-drop-hint="refused"]')).toBeNull()
    }, 60000)
})
