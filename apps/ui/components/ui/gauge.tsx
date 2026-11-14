'use client'

import { useId } from 'react'

import { cn } from '@/lib/utils'

type GaugeProps = {
    ratio: number
    complete?: boolean
    strokeWidth?: number
    gradient?: readonly [string, string]
    className?: string
}

export function Gauge({ ratio, complete, strokeWidth = 2, gradient, className }: GaugeProps) {
    const gradientId = useId()
    const r = 9 - strokeWidth
    const c = 2 * Math.PI * r
    const clamped = Math.min(Math.max(ratio, 0), 1)
    const tipAngle = 2 * Math.PI * Math.min(clamped, 0.5)
    return (
        <svg className={cn('size-4.5 [--gauge-duration:300ms]', className)} viewBox="0 0 18 18" aria-hidden>
            <g transform="rotate(-90 9 9)">
                {gradient && (
                    <defs>
                        <linearGradient id={gradientId} x1={9 + r} y1={9} x2={9 + r * Math.cos(tipAngle)} y2={9 + r * Math.sin(tipAngle)} gradientUnits="userSpaceOnUse">
                            <stop offset="0" style={{ stopColor: gradient[0] }} />
                            <stop offset="1" style={{ stopColor: gradient[1] }} />
                        </linearGradient>
                    </defs>
                )}
                <circle cx="9" cy="9" r={r} fill="none" strokeWidth={strokeWidth} className="stroke-current opacity-20" />
                <circle cx="9" cy="9" r={r} fill="none" strokeWidth={strokeWidth} strokeLinecap="round" stroke={gradient ? `url(#${gradientId})` : undefined} className={cn('transition-[stroke-dashoffset] duration-(--gauge-duration) ease-out', !gradient && 'stroke-current')} strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} />
            </g>
            {complete && <path d="M6 9.3 8.1 11.4 12 7" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="stroke-current" />}
        </svg>
    )
}
