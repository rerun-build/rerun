import { describe, expect, it } from 'vitest'
import { DOCK_WINDOW_WIDTH, dockBounds, dockDisplay, dropPlacement, pointInRect, storedDockPlacement } from '../src/main/coworker-dock-placement'

const main = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } }
const external = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }

describe('storedDockPlacement', () => {
    it('puts a fresh install on, on the right edge, in the middle', () => {
        expect(storedDockPlacement(undefined)).toEqual({ enabled: true, edge: 'right', y: 0.5, collapsed: false, displayId: null })
    })

    it('keeps what the person chose, and clamps a height out of bounds', () => {
        expect(storedDockPlacement({ enabled: false, edge: 'left', y: 3, collapsed: true, displayId: 2 })).toEqual({ enabled: false, edge: 'left', y: 1, collapsed: true, displayId: 2 })
        expect(storedDockPlacement({ y: Number.NaN }).y).toBe(0.5)
    })
})

describe('dockDisplay', () => {
    it('finds the display the dock was put on', () => {
        expect(dockDisplay([main, external], main, 2)).toBe(external)
    })

    it('falls back to the main display once that one is unplugged', () => {
        expect(dockDisplay([main], main, 2)).toBe(main)
        expect(dockDisplay([main, external], main, null)).toBe(main)
    })
})

describe('dockBounds', () => {
    it('glues a strip as tall as the work area to the edge', () => {
        expect(dockBounds(main.workArea, 'right')).toEqual({ x: 1440 - DOCK_WINDOW_WIDTH, y: 25, width: DOCK_WINDOW_WIDTH, height: 875 })
        expect(dockBounds(external.workArea, 'left')).toEqual({ x: 1440, y: 0, width: DOCK_WINDOW_WIDTH, height: 1080 })
    })
})

describe('dropPlacement', () => {
    it('picks the edge from the half of the display the rail is let go on', () => {
        expect(dropPlacement({ x: 100, y: 400 }, main.workArea).edge).toBe('left')
        expect(dropPlacement({ x: 1000, y: 400 }, main.workArea).edge).toBe('right')
        expect(dropPlacement({ x: 1500, y: 400 }, external.workArea).edge).toBe('left')
    })

    it('follows the pointer down the edge, from 0 at the top to 1 at the bottom', () => {
        expect(dropPlacement({ x: 1400, y: 0 }, main.workArea).y).toBe(0)
        expect(dropPlacement({ x: 1400, y: 2000 }, main.workArea).y).toBe(1)
        expect(dropPlacement({ x: 1400, y: 25 + 40 + (875 - 80) / 2 }, main.workArea).y).toBeCloseTo(0.5)
    })
})

describe('pointInRect', () => {
    it('says whether the pointer is over the rail', () => {
        const rail = { x: 200, y: 300, width: 52, height: 240 }
        expect(pointInRect({ x: 220, y: 310 }, rail)).toBe(true)
        expect(pointInRect({ x: 120, y: 310 }, rail)).toBe(false)
    })
})
