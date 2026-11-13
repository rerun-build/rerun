import type { SheetDetent } from '@/components/layout/useSheetResize'

export const SIDE_PANEL_DEFAULT_WIDTH = 640
export const SIDE_PANEL_MIN_WIDTH = 480
export const SIDE_PANEL_MAX_WIDTH = 800
/** Doit rester d'accord avec le `60vw` de la classe `max-w` de `SidePanel`. */
export const SIDE_PANEL_MAX_VIEWPORT_RATIO = 0.6
/** Le panneau flotte sur le board ; doit rester d'accord avec les `md:top-2 md:right-2 md:bottom-2` de `SidePanel`. */
export const SIDE_PANEL_GAP = 8

// Une seule largeur pour tous les panneaux latéraux ; la clé garde son ancien nom pour
// ne pas réinitialiser celle que les utilisateurs ont déjà réglée sur le panneau agent.
export const SIDE_PANEL_WIDTH_STORAGE_KEY = 'rerun-agent-panel-width'

// A resizable panel: where its width is remembered, its bounds, and the share of the window it may take.
export type PanelWidthConfig = { storageKey: string; defaultWidth: number; min: number; max: number; maxViewportRatio: number }

export const SIDE_PANEL_WIDTH: PanelWidthConfig = { storageKey: SIDE_PANEL_WIDTH_STORAGE_KEY, defaultWidth: SIDE_PANEL_DEFAULT_WIDTH, min: SIDE_PANEL_MIN_WIDTH, max: SIDE_PANEL_MAX_WIDTH, maxViewportRatio: SIDE_PANEL_MAX_VIEWPORT_RATIO }

export function getSidePanelMaxWidth(viewportWidth: number, config: PanelWidthConfig = SIDE_PANEL_WIDTH): number {
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return config.defaultWidth
    return Math.max(config.min, Math.min(config.max, Math.floor(viewportWidth * config.maxViewportRatio)))
}

export function clampSidePanelWidth(width: number, viewportWidth: number, config: PanelWidthConfig = SIDE_PANEL_WIDTH): number {
    const safeWidth = Number.isFinite(width) ? Math.round(width) : config.defaultWidth
    return Math.min(Math.max(safeWidth, config.min), getSidePanelMaxWidth(viewportWidth, config))
}

export function parseSidePanelWidth(value: string | null, viewportWidth: number, config: PanelWidthConfig = SIDE_PANEL_WIDTH): number {
    if (value === null || value.trim() === '') return clampSidePanelWidth(config.defaultWidth, viewportWidth, config)

    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return clampSidePanelWidth(config.defaultWidth, viewportWidth, config)

    return clampSidePanelWidth(parsed, viewportWidth, config)
}

export function loadSidePanelWidth(viewportWidth: number, config: PanelWidthConfig = SIDE_PANEL_WIDTH): number {
    try {
        return parseSidePanelWidth(localStorage.getItem(config.storageKey), viewportWidth, config)
    } catch {
        return clampSidePanelWidth(config.defaultWidth, viewportWidth, config)
    }
}

export function saveSidePanelWidth(width: number, viewportWidth: number, config: PanelWidthConfig = SIDE_PANEL_WIDTH): number {
    const clamped = clampSidePanelWidth(width, viewportWidth, config)
    try {
        localStorage.setItem(config.storageKey, String(clamped))
    } catch {}
    return clamped
}

export const SIDE_PANEL_SHEET_DETENT_STORAGE_KEY = 'rerun:agent-sheet-detent'

/** Sous `md` le panneau est une sheet : son contenu n'a pas de hauteur propre, elle s'ouvre au grand cran. */
export function loadSidePanelSheetDetent(): SheetDetent {
    try {
        return localStorage.getItem(SIDE_PANEL_SHEET_DETENT_STORAGE_KEY) === 'medium' ? 'medium' : 'large'
    } catch {
        return 'large'
    }
}

export function rememberSidePanelSheetDetent(detent: SheetDetent): void {
    try {
        localStorage.setItem(SIDE_PANEL_SHEET_DETENT_STORAGE_KEY, detent)
    } catch {}
}
