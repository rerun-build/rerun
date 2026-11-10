'use client'


import { ClockIcon, FlagCheckeredIcon } from '../../icons'
import { countdownShort, isCountdownSoon, resultsCount } from '../countdown'
import { useCountdownNow } from '../hooks/useCountdownNow'
import type { TileCountdown, TileResults } from '../types'
import { useKitTranslations } from '../../locale'

export const RESULTS_GREEN = '#34d399'

// The pill above the head: what is waiting to be seen, then what comes next. Results come first,
// they want you now.
export function TileCountdownBadge({ countdown, results }: { countdown?: TileCountdown; results?: TileResults }) {
    const t = useKitTranslations()
    const now = useCountdownNow(countdown?.at ?? 0)
    const remainingMs = countdown && now != null ? countdown.at - now : 0
    const showsCountdown = remainingMs > 0
    const showsResults = !!results && results.count > 0
    if (!showsCountdown && !showsResults) return null

    return (
        <span className="iso-buddy-label flex h-[11px] items-center gap-1 rounded-full px-1 text-[7px] font-medium whitespace-nowrap tabular-nums">
            {showsResults && (
                <span className="flex shrink-0 items-center gap-0.5 font-semibold">
                    <FlagCheckeredIcon className="size-[8px] shrink-0" style={{ color: RESULTS_GREEN }} />
                    {resultsCount(results.count)}
                </span>
            )}
            {showsResults && showsCountdown && <span aria-hidden className="h-[6px] w-px shrink-0 bg-current opacity-30" />}
            {showsCountdown && (
                <span className="flex shrink-0 items-center gap-0.5" style={{ opacity: isCountdownSoon(remainingMs) ? 1 : 0.6 }}>
                    <ClockIcon className="size-[8px] shrink-0" />
                    {countdownShort(remainingMs, t)}
                </span>
            )}
        </span>
    )
}
