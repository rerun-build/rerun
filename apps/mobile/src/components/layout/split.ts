export const SIDEBAR = { min: 260, max: 340, share: 0.32 } as const
export const DETAIL_MIN_WIDTH = 360

export function sidebarWidth(windowWidth: number): number {
    return Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(windowWidth * SIDEBAR.share)))
}

export function isSplit(windowWidth: number): boolean {
    return windowWidth - sidebarWidth(windowWidth) >= DETAIL_MIN_WIDTH
}

export function columnsFor(width: number, minCell: number, fewest: number): number {
    return Math.max(fewest, Math.floor(width / minCell))
}

export const CHAT_COLUMN_MAX_WIDTH = 760

export const FORM_COLUMN_MAX_WIDTH = 440
