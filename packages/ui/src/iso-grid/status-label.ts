import type { KitTranslator } from '../kit-translator'
import type { TileStatusLabelKey } from './types'

export function tileStatusLabel(status: { label?: string; labelKey?: TileStatusLabelKey }, t: KitTranslator): string | undefined {
    return status.labelKey ? t(`isoGrid.status.${status.labelKey}`) : status.label
}
