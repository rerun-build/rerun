'use client'

import { memo } from 'react'

import { useUiLocale } from '../../locale'
import { shortRelativeTime } from '../../time'
import { BLOCK_HEIGHT, DEFAULT_SPAN, TILE_H, TILE_W, buddyFootprintShare, isoPosition, tileTopLift } from '../iso'
import type { Tile, TileResults } from '../types'
import { RESULTS_GREEN } from './TileCountdownBadge'
import { BUDDY_BADGE_GAP } from './TileBuddy'
import { FlagCheckeredIcon } from '../../icons'

const CARD_ROWS = 3
// Room left between the card and the pill it rises from.
const CARD_GAP = 8

type Props = {
    tile: Tile | null
    worldOffset: { left: number; top: number }
    reducedMotion?: boolean
}

// What the hovered coworker finished: one line per result, newest first, three at most then the
// rest as a count. The pill under it does not move, so nothing here repeats the delay.
export const TileResultsCard = memo(function TileResultsCard({ tile, worldOffset, reducedMotion }: Props) {
    const results = tile?.style.results
    if (!tile || !results || results.count === 0 || tile.style.badge) return null

    const span = tile.span ?? DEFAULT_SPAN
    const pos = isoPosition(tile.position.col, tile.position.row)
    // The same point TileBlock floats its pill at.
    const headTop = tile.style.buddy
        ? ((span * TILE_H) / 2) * (1 - buddyFootprintShare(tile.style)) - tileTopLift(tile.style, span) - BUDDY_BADGE_GAP
        : -(tile.style.depth ?? BLOCK_HEIGHT) - 18
    return (
        <div
            className="pointer-events-none absolute"
            style={{
                left: pos.left + worldOffset.left + TILE_W / 2,
                top: pos.top + worldOffset.top + headTop - CARD_GAP,
                transform: 'translate(-50%, -100%)',
                zIndex: 99990,
            }}
        >
            <TileResultsList key={tile.id} results={results} animated={!reducedMotion} />
        </div>
    )
})

export function TileResultsList({ results, animated = true }: { results: TileResults; animated?: boolean }) {
    const locale = useUiLocale()
    const rows = results.items.slice(0, CARD_ROWS)
    const hidden = results.items.slice(CARD_ROWS).reduce((sum, item) => sum + item.count, 0)
    return (
        <span
            className="flex w-max max-w-[140px] min-w-[96px] flex-col gap-1 rounded-[7px] border border-border bg-card p-1.5 text-left text-[6.5px] leading-tight shadow-xl"
            style={{ animation: animated ? 'agent-toast-in 200ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined }}
        >
            {rows.map((item, index) => (
                <span key={`${item.label}-${index}`} className="flex items-center gap-1 text-foreground/85">
                    <FlagCheckeredIcon className="size-[7px] shrink-0" style={{ color: RESULTS_GREEN }} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count > 1 && <span className="shrink-0 rounded-full bg-muted px-[3px] font-semibold text-foreground/80 tabular-nums">×{item.count}</span>}
                    <span className="shrink-0 text-muted-foreground tabular-nums">{shortRelativeTime(new Date(item.at).toISOString(), locale)}</span>
                </span>
            ))}
            {hidden > 0 && <span className="pl-[11px] text-muted-foreground tabular-nums">+{hidden}</span>}
        </span>
    )
}
