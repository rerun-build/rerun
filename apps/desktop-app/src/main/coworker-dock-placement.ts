import { COWORKER_DOCK_MIN_HEIGHT, type CoworkerDockEdge } from '@rerun/contracts'
import type { StoredCoworkerDock } from './settings'

// Where the coworker dock stands, without Electron: the window is a strip as tall as the display's
// work area, glued to one edge, wide enough for the rail and the card that opens beside it.

export const DOCK_WINDOW_WIDTH = 440

// The rail never sits flush against the top or the bottom of the screen: the same margin the page
// keeps when it follows the pointer.
export const DOCK_DRAG_MARGIN = 40

const DOCK_MAX_HEIGHT = 10_000

type Area = { x: number; y: number; width: number; height: number }
type DisplayLike = { id: number; workArea: Area }

export type DockPlacement = { enabled: boolean; edge: CoworkerDockEdge; y: number; maxHeight: number | null; collapsed: boolean; displayId: number | null }

export function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value))
}

// Null, the rail grows with its coworkers up to the screen.
export function dockMaxHeight(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return Math.round(Math.min(DOCK_MAX_HEIGHT, Math.max(COWORKER_DOCK_MIN_HEIGHT, value)))
}

export function storedDockPlacement(stored: StoredCoworkerDock | undefined): DockPlacement {
    const y = typeof stored?.y === 'number' && Number.isFinite(stored.y) ? clamp01(stored.y) : 0.5
    return {
        enabled: stored?.enabled !== false,
        edge: stored?.edge === 'left' ? 'left' : 'right',
        y,
        maxHeight: dockMaxHeight(stored?.maxHeight),
        collapsed: stored?.collapsed === true,
        displayId: typeof stored?.displayId === 'number' ? stored.displayId : null,
    }
}

// The display the person put it on, or the main one once that display is gone.
export function dockDisplay<D extends DisplayLike>(displays: readonly D[], primary: D, displayId: number | null): D {
    return displays.find((display) => display.id === displayId) ?? primary
}

export function dockBounds(workArea: Area, edge: CoworkerDockEdge): Area {
    const width = Math.min(DOCK_WINDOW_WIDTH, workArea.width)
    return { x: edge === 'right' ? workArea.x + workArea.width - width : workArea.x, y: workArea.y, width, height: workArea.height }
}

// Let go on the left half of a display, it hugs the left edge; its height follows the pointer.
// `railY`: where the page moved the rail along the edge, kept as it is; without it, from the pointer.
export function dropPlacement(point: { x: number; y: number }, workArea: Area, railY: number | null = null): { edge: CoworkerDockEdge; y: number } {
    const edge: CoworkerDockEdge = point.x < workArea.x + workArea.width / 2 ? 'left' : 'right'
    if (railY !== null) return { edge, y: clamp01(railY) }
    const travel = Math.max(1, workArea.height - DOCK_DRAG_MARGIN * 2)
    return { edge, y: clamp01((point.y - workArea.y - DOCK_DRAG_MARGIN) / travel) }
}

export function pointInRect(point: { x: number; y: number }, rect: Area): boolean {
    return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}
