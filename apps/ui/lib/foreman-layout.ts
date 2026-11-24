import type { TextDirection } from '@rerun/i18n'

import { coversTheBoard } from '@/lib/foreman-open'

export type ForemanCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type ForemanDockSide = 'left' | 'right'

/**
 * Où la colonne se pose à partir de `md`. `width` et `height` sont la taille de la fenêtre flottante,
 * `dockWidth` la largeur de la piste docké : les deux voyagent avec l'autre mode, redocker puis
 * refaire flotter rend chaque taille qu'on avait tirée.
 */
export type ForemanPlacement = ({ mode: 'dock'; side: ForemanDockSide } | { mode: 'float'; corner: ForemanCorner }) & ForemanSizes
type ForemanSizes = { width: number; height: number; dockWidth: number }

export const FOREMAN_PLACEMENT_STORAGE_KEY = 'rerun:foreman-placement'
export const FOREMAN_PLACEMENT_COOKIE = 'rerun-foreman-placement'
const FOREMAN_PLACEMENT_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export const FOREMAN_ORB_CORNER_STORAGE_KEY = 'rerun:foreman-orb-corner'

export const FOREMAN_FLOAT_DEFAULT_SIZE = { width: 480, height: 720 }
export const FOREMAN_FLOAT_MIN_SIZE = { width: 360, height: 420 }
export const FOREMAN_DOCK_DEFAULT_WIDTH = 480
export const FOREMAN_DOCK_MIN_WIDTH = 360
const FOREMAN_DOCK_MAX_WIDTH = 800
/** La part de l'écran que la piste docké peut prendre au board. Doit rester d'accord avec le `60vw` des classes de piste. */
const FOREMAN_DOCK_MAX_VIEWPORT_SHARE = 0.6
/** L'écart au bord de l'écran sous lequel lâcher la colonne la docke au lieu de la faire flotter. */
const DOCK_SNAP_DISTANCE = 80
/** Ce que la fenêtre flottante laisse autour d'elle : 1rem de marge plus l'inset du board, de chaque côté. */
const FLOAT_VIEWPORT_GUTTER = 50

export const DEFAULT_FOREMAN_PLACEMENT: ForemanPlacement = { mode: 'dock', side: 'right', ...FOREMAN_FLOAT_DEFAULT_SIZE, dockWidth: FOREMAN_DOCK_DEFAULT_WIDTH }

const CORNERS: readonly ForemanCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
// Le suffixe de largeur du dock est arrivé après coup : un cookie écrit sans lui reste valide.
const PLACEMENT_PATTERN = /^(dock|float)-(left|right|top-left|top-right|bottom-left|bottom-right):(\d{2,4})x(\d{2,4})(?::(\d{2,4}))?$/

export function isForemanCorner(value: unknown): value is ForemanCorner {
    return typeof value === 'string' && (CORNERS as readonly string[]).includes(value)
}

export function serializeForemanPlacement(placement: ForemanPlacement): string {
    const anchor = placement.mode === 'dock' ? placement.side : placement.corner
    return `${placement.mode}-${anchor}:${Math.round(placement.width)}x${Math.round(placement.height)}:${Math.round(placement.dockWidth)}`
}

export function parseForemanPlacement(value: string | null | undefined): ForemanPlacement | null {
    const match = value ? PLACEMENT_PATTERN.exec(value) : null
    if (!match) return null
    const [, mode, anchor, width, height, dockWidth] = match
    const size = {
        width: Math.max(FOREMAN_FLOAT_MIN_SIZE.width, Number(width)),
        height: Math.max(FOREMAN_FLOAT_MIN_SIZE.height, Number(height)),
        dockWidth: dockWidth ? Math.min(FOREMAN_DOCK_MAX_WIDTH, Math.max(FOREMAN_DOCK_MIN_WIDTH, Number(dockWidth))) : FOREMAN_DOCK_DEFAULT_WIDTH,
    }
    if (mode === 'dock' && (anchor === 'left' || anchor === 'right')) return { mode, side: anchor, ...size }
    if (mode === 'float' && isForemanCorner(anchor)) return { mode, corner: anchor, ...size }
    return null
}

export function loadForemanPlacement(): ForemanPlacement {
    try {
        return parseForemanPlacement(localStorage.getItem(FOREMAN_PLACEMENT_STORAGE_KEY)) ?? DEFAULT_FOREMAN_PLACEMENT
    } catch {
        return DEFAULT_FOREMAN_PLACEMENT
    }
}

/** Même montage que l'ouverture (lib/foreman-open) : le cookie laisse le serveur rendre la colonne déjà à sa place. */
export function rememberForemanPlacement(placement: ForemanPlacement): void {
    if (coversTheBoard()) return
    const value = serializeForemanPlacement(placement)
    try {
        localStorage.setItem(FOREMAN_PLACEMENT_STORAGE_KEY, value)
    } catch {}
    const parts = [`${FOREMAN_PLACEMENT_COOKIE}=${value}`, 'path=/', `max-age=${FOREMAN_PLACEMENT_COOKIE_MAX_AGE}`, 'SameSite=Lax']
    if (window.location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
}

export function loadForemanOrbCorner(): ForemanCorner {
    try {
        const stored = localStorage.getItem(FOREMAN_ORB_CORNER_STORAGE_KEY)
        return isForemanCorner(stored) ? stored : 'bottom-right'
    } catch {
        return 'bottom-right'
    }
}

export function rememberForemanOrbCorner(corner: ForemanCorner): void {
    try {
        localStorage.setItem(FOREMAN_ORB_CORNER_STORAGE_KEY, corner)
    } catch {}
}

type Point = { x: number; y: number }
type Size = { width: number; height: number }

// A placement's "left" and "right" are those of a left-to-right page: a right-to-left one mirrors
// them, so a pointer is read from the reading start.
function fromReadingStart(x: number, viewport: Size, direction: TextDirection): number {
    return direction === 'rtl' ? viewport.width - x : x
}

export function resolveCorner(point: Point, viewport: Size, direction: TextDirection = 'ltr'): ForemanCorner {
    const vertical = point.y < viewport.height / 2 ? 'top' : 'bottom'
    const horizontal = fromReadingStart(point.x, viewport, direction) < viewport.width / 2 ? 'left' : 'right'
    return `${vertical}-${horizontal}`
}

/**
 * La place où la colonne atterrira si on la lâche maintenant. Le dock se décide sur le pointeur, qui
 * doit toucher le bord ; le coin sur le centre de la fenêtre, qui est ce que l'œil voit bouger.
 */
export function resolveDropTarget({ pointer, panelCenter, viewport, size, direction = 'ltr' }: { pointer: Point; panelCenter: Point; viewport: Size; size: ForemanSizes; direction?: TextDirection }): ForemanPlacement {
    const x = fromReadingStart(pointer.x, viewport, direction)
    if (x <= DOCK_SNAP_DISTANCE) return { mode: 'dock', side: 'left', ...size }
    if (x >= viewport.width - DOCK_SNAP_DISTANCE) return { mode: 'dock', side: 'right', ...size }
    return { mode: 'float', corner: resolveCorner(panelCenter, viewport, direction), ...size }
}

export function clampForemanFloatSize(size: Size, viewport: Size): Size {
    const maxWidth = Math.max(FOREMAN_FLOAT_MIN_SIZE.width, viewport.width - FLOAT_VIEWPORT_GUTTER)
    const maxHeight = Math.max(FOREMAN_FLOAT_MIN_SIZE.height, viewport.height - FLOAT_VIEWPORT_GUTTER)
    return {
        width: Math.round(Math.min(maxWidth, Math.max(FOREMAN_FLOAT_MIN_SIZE.width, size.width))),
        height: Math.round(Math.min(maxHeight, Math.max(FOREMAN_FLOAT_MIN_SIZE.height, size.height))),
    }
}

export function clampForemanDockWidth(width: number, viewportWidth: number): number {
    const maxWidth = Math.max(FOREMAN_DOCK_MIN_WIDTH, Math.min(FOREMAN_DOCK_MAX_WIDTH, viewportWidth * FOREMAN_DOCK_MAX_VIEWPORT_SHARE))
    return Math.round(Math.min(maxWidth, Math.max(FOREMAN_DOCK_MIN_WIDTH, width)))
}

export function sameForemanPlacement(a: ForemanPlacement, b: ForemanPlacement): boolean {
    return serializeForemanPlacement(a) === serializeForemanPlacement(b)
}

/** Le côté dont la colonne occupe une piste de grille, ou `null` quand elle flotte, se déplace ou est fermée. */
export function dockedForemanSide({ open, placement, dragging }: { open: boolean | null; placement: ForemanPlacement; dragging: boolean }): ForemanDockSide | null {
    if (open === false || dragging || placement.mode !== 'dock') return null
    return placement.side
}
