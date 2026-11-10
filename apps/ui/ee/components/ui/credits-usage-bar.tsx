import { cn } from '@/lib/utils'
import NumberFlow from '@number-flow/react'
import { formatDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import type { CSSProperties } from 'react'

const PERCENT_FORMAT = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const

// Animated usage percentage. `className` carries the size/layout (always applied);
// `mutedColor` is the resting color, overridden to red when the budget is exhausted.
function UsagePercent({ percent, exhausted, className, mutedColor }: { percent: number; exhausted: boolean; className?: string; mutedColor: string }) {
    const locale = useLocale()
    return <NumberFlow value={percent} suffix="%" format={PERCENT_FORMAT} locales={locale} className={cn('font-mono leading-none font-medium tabular-nums', className, exhausted ? 'text-red-500 dark:text-red-400' : mutedColor)} />
}

type CreditsUsageBarProps = {
    usedMicros?: number | null
    budgetMicros?: number | null
    resetAt?: string | null
    className?: string
}

// The ticks are a repeating mask over two layers, not one node per tick. The bar sits on surfaces
// that resize, so a fixed tick count would grow fat ticks as they widen, and a measured count would
// re-render hundreds of nodes on every drag frame. A pitch expressed in pixels keeps the tick width
// constant and lets their number follow the width for free.
type TickGeometry = { width: number; gap: number; height: number }

const TICKS: TickGeometry = { width: 4, gap: 3, height: 21 }

function tickMask({ width, gap, height }: TickGeometry): CSSProperties {
    const pitch = width + gap
    const tick = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pitch} ${height}" width="${pitch}" height="${height}"><rect width="${width}" height="${height}" rx="${width / 2}" fill="#000"/></svg>`
    return {
        maskImage: `url("data:image/svg+xml,${encodeURIComponent(tick)}")`,
        maskSize: `${pitch}px ${height}px`,
        maskRepeat: 'repeat-x',
    }
}

export function CreditsUsageBar({ usedMicros, budgetMicros, resetAt, className }: CreditsUsageBarProps) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const budget = budgetMicros ?? 0
    if (budget <= 0) return null

    const used = Math.min(usedMicros ?? 0, budget)
    const percent = Math.min(100, (used / budget) * 100)
    const exhausted = (usedMicros ?? 0) >= budget

    const mask = tickMask(TICKS)
    const accent = exhausted ? '#ef4444' : 'var(--color-brand)'

    const bar = (
        // The height is inline because the mask tile has to match it exactly.
        <div className="relative" style={{ height: TICKS.height }}>
            {/* The empty ticks are a tint of the text color, not `bg-muted`: the bar sits on surfaces
                that are themselves `bg-muted` and the track would vanish into them. */}
            <div className="absolute inset-0 bg-muted-foreground/25" style={mask} />
            {/* The glow lives on the wrapper: a filter on the masked box itself would be clipped away by the mask. */}
            <div className="credits-bar-glow absolute inset-y-0 left-0" style={{ width: `${percent}%`, '--credits-accent': accent } as CSSProperties}>
                <div className="size-full" style={{ ...mask, backgroundImage: `linear-gradient(90deg, color-mix(in oklab, ${accent}, white var(--credits-highlight)), ${accent})` }} />
            </div>
        </div>
    )

    return (
        <div className={cn('mt-3 flex flex-col gap-3', className)}>
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t('creditsBar.used')}</span>
                <UsagePercent percent={percent} exhausted={exhausted} className="text-xs" mutedColor="text-foreground" />
            </div>

            {bar}

            {resetAt && <span className="text-[11px] text-muted-foreground">{t('creditsBar.resetsOn', { date: formatDate(resetAt, locale, { year: 'numeric', month: 'numeric', day: 'numeric' }) })}</span>}
        </div>
    )
}
