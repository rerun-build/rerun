export const CHART_PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444', '#84cc16']

export const CHART_FALLBACK_COLOR = '#9ca3af'

export function chartColorAt(index: number): string {
    return CHART_PALETTE[index % CHART_PALETTE.length]
}
