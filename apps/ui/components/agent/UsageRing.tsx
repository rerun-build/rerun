import type { ReactNode } from 'react'

import { planLimitTone, type PillUsage, type PlanLimitTone } from '@/lib/engine/ai-sources'
import { cn } from '@/lib/utils'

const TONE_STROKE: Record<PlanLimitTone, string> = { brand: 'var(--color-brand)', warning: 'var(--color-amber-500)', destructive: 'var(--destructive)' }

const SIZE = 18
const CENTER = SIZE / 2

function Arc({ radius, stroke, percent }: { radius: number; stroke: number; percent: number }) {
    const circumference = 2 * Math.PI * radius
    const filled = circumference * (Math.min(Math.max(percent, 0), 100) / 100)
    return (
        <>
            <circle cx={CENTER} cy={CENTER} r={radius} fill="none" strokeWidth={stroke} className="stroke-current opacity-15" />
            <circle
                cx={CENTER}
                cy={CENTER}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="round"
                stroke={TONE_STROKE[planLimitTone(percent)]}
                strokeDasharray={`${filled} ${circumference}`}
                className={cn('transition-[stroke-dasharray,stroke] duration-500 ease-out', filled === 0 && 'opacity-0')}
            />
        </>
    )
}

/** A provider's mark inside the rings of its plan: the session inside, the longer window outside. */
export function UsageRing({ usage, children }: { usage: PillUsage; children: ReactNode }) {
    const double = usage.outer !== null
    return (
        // The negative margin keeps the pill at the height its bare 14px logo gave it.
        <span className="relative -my-0.5 inline-flex size-4.5 shrink-0 items-center justify-center">
            <svg className="absolute inset-0 size-full" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
                <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
                    {usage.outer !== null && <Arc radius={8.4} stroke={1.2} percent={usage.outer} />}
                    <Arc radius={double ? 6.3 : 8.25} stroke={double ? 1.2 : 1.5} percent={usage.inner} />
                </g>
            </svg>
            <span className={cn('relative inline-flex items-center justify-center [&>svg]:size-full', double ? 'size-2' : 'size-[11px]')}>{children}</span>
        </span>
    )
}
