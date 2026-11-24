import { describe, expect, it } from 'vitest'
import {
    DEFAULT_FOREMAN_PLACEMENT,
    type ForemanPlacement,
    clampForemanDockWidth,
    clampForemanFloatSize,
    dockedForemanSide,
    parseForemanPlacement,
    resolveCorner,
    resolveDropTarget,
    serializeForemanPlacement,
} from './foreman-layout'

const viewport = { width: 1440, height: 900 }
const size = { width: 480, height: 720, dockWidth: 480 }

describe('placement serialization', () => {
    it('round-trips docks and floating corners with their size', () => {
        const placements: ForemanPlacement[] = [
            { mode: 'dock', side: 'left', ...size },
            { mode: 'dock', side: 'right', width: 520, height: 640, dockWidth: 620 },
            { mode: 'float', corner: 'top-left', ...size },
            { mode: 'float', corner: 'bottom-right', width: 400, height: 500, dockWidth: 400 },
        ]
        for (const placement of placements) expect(parseForemanPlacement(serializeForemanPlacement(placement))).toEqual(placement)
    })

    it('rejects anything it did not write', () => {
        expect(parseForemanPlacement(undefined)).toBeNull()
        expect(parseForemanPlacement('')).toBeNull()
        expect(parseForemanPlacement('dock-top-left:480x720')).toBeNull()
        expect(parseForemanPlacement('float-left:480x720')).toBeNull()
        expect(parseForemanPlacement('float-bottom-right')).toBeNull()
    })

    it('lifts a stored size back over the minimum', () => {
        expect(parseForemanPlacement('float-top-right:100x100')).toMatchObject({ width: 360, height: 420 })
        expect(parseForemanPlacement('dock-left:480x720:100')).toMatchObject({ dockWidth: 360 })
    })

    it('reads a placement stored before the dock width, at the default width', () => {
        expect(parseForemanPlacement('dock-right:520x640')).toEqual({ mode: 'dock', side: 'right', width: 520, height: 640, dockWidth: 480 })
    })
})

describe('resolveCorner', () => {
    it('picks the quadrant of the point', () => {
        expect(resolveCorner({ x: 100, y: 100 }, viewport)).toBe('top-left')
        expect(resolveCorner({ x: 1300, y: 100 }, viewport)).toBe('top-right')
        expect(resolveCorner({ x: 100, y: 800 }, viewport)).toBe('bottom-left')
        expect(resolveCorner({ x: 1300, y: 800 }, viewport)).toBe('bottom-right')
    })
})

describe('resolveDropTarget', () => {
    it('docks when the pointer touches a side of the screen', () => {
        expect(resolveDropTarget({ pointer: { x: 20, y: 450 }, panelCenter: { x: 260, y: 450 }, viewport, size })).toEqual({ mode: 'dock', side: 'left', ...size })
        expect(resolveDropTarget({ pointer: { x: 1420, y: 450 }, panelCenter: { x: 1180, y: 450 }, viewport, size })).toEqual({ mode: 'dock', side: 'right', ...size })
    })

    it('floats to the corner of the window center everywhere else', () => {
        expect(resolveDropTarget({ pointer: { x: 500, y: 40 }, panelCenter: { x: 700, y: 400 }, viewport, size })).toEqual({ mode: 'float', corner: 'top-left', ...size })
        expect(resolveDropTarget({ pointer: { x: 900, y: 40 }, panelCenter: { x: 1000, y: 500 }, viewport, size })).toEqual({ mode: 'float', corner: 'bottom-right', ...size })
    })

    it('reads the screen from its right edge in a right-to-left page', () => {
        expect(resolveDropTarget({ pointer: { x: 1420, y: 450 }, panelCenter: { x: 1180, y: 450 }, viewport, size, direction: 'rtl' })).toEqual({ mode: 'dock', side: 'left', ...size })
        expect(resolveDropTarget({ pointer: { x: 900, y: 40 }, panelCenter: { x: 1000, y: 500 }, viewport, size, direction: 'rtl' })).toEqual({ mode: 'float', corner: 'bottom-left', ...size })
        expect(resolveCorner({ x: 100, y: 100 }, viewport, 'rtl')).toBe('top-right')
    })
})

describe('clampForemanFloatSize', () => {
    it('keeps the window between its minimum and the screen', () => {
        expect(clampForemanFloatSize({ width: 100, height: 100 }, viewport)).toEqual({ width: 360, height: 420 })
        expect(clampForemanFloatSize({ width: 3000, height: 3000 }, viewport)).toEqual({ width: 1390, height: 850 })
    })
})

describe('clampForemanDockWidth', () => {
    it('keeps the dock between its minimum and a share of the screen', () => {
        expect(clampForemanDockWidth(100, 1440)).toBe(360)
        expect(clampForemanDockWidth(560, 1440)).toBe(560)
        expect(clampForemanDockWidth(3000, 1440)).toBe(800)
        expect(clampForemanDockWidth(900, 1000)).toBe(600)
    })
})

describe('dockedForemanSide', () => {
    const left: ForemanPlacement = { mode: 'dock', side: 'left', ...size }
    const floating: ForemanPlacement = { mode: 'float', corner: 'top-right', ...size }

    it('opens a track only for an open, docked column at rest', () => {
        expect(dockedForemanSide({ open: true, placement: left, dragging: false })).toBe('left')
        expect(dockedForemanSide({ open: null, placement: DEFAULT_FOREMAN_PLACEMENT, dragging: false })).toBe('right')
        expect(dockedForemanSide({ open: false, placement: left, dragging: false })).toBeNull()
        expect(dockedForemanSide({ open: true, placement: left, dragging: true })).toBeNull()
        expect(dockedForemanSide({ open: true, placement: floating, dragging: false })).toBeNull()
    })
})
