'use client'

import { cn } from '../cn'
import { type ReactNode, useId } from 'react'

const WAVELENGTH = 12
const AMPLITUDE = 2
const WAVE_HEIGHT = AMPLITUDE * 2 + 2

const FADE_TOWARD_EDGE = {
    left: '[mask-image:linear-gradient(to_right,transparent,black_70%)]',
    right: '[mask-image:linear-gradient(to_left,transparent,black_70%)]',
}

function WaveLine({ side, flowing }: { side: 'left' | 'right'; flowing: boolean }) {
    const patternId = `divider-wave${useId().replace(/[^a-zA-Z0-9]/g, '')}`
    const middle = WAVE_HEIGHT / 2

    return (
        <svg aria-hidden height={WAVE_HEIGHT} className={cn('min-w-0 flex-1 text-border', FADE_TOWARD_EDGE[side])}>
            <defs>
                <pattern id={patternId} width={WAVELENGTH} height={WAVE_HEIGHT} patternUnits="userSpaceOnUse">
                    <path d={`M0 ${middle} Q ${WAVELENGTH / 4} ${middle - AMPLITUDE * 2} ${WAVELENGTH / 2} ${middle} T ${WAVELENGTH} ${middle}`} fill="none" stroke="currentColor" strokeWidth={1} />
                    {flowing && <animateTransform attributeName="patternTransform" type="translate" from="0 0" to={`${side === 'left' ? WAVELENGTH : -WAVELENGTH} 0`} dur="1.4s" repeatCount="indefinite" />}
                </pattern>
            </defs>
            <rect width="100%" height={WAVE_HEIGHT} fill={`url(#${patternId})`} />
        </svg>
    )
}

export function ThreadDividerLine({ icon, flowing = false, children }: { icon: ReactNode; flowing?: boolean; children: ReactNode }) {
    return (
        <div className="flex w-full items-center gap-3 py-1 text-xs text-muted-foreground">
            <WaveLine side="left" flowing={flowing} />
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                {icon}
                {children}
            </span>
            <WaveLine side="right" flowing={flowing} />
        </div>
    )
}

export function ThreadDividerDot() {
    return <span aria-hidden>·</span>
}

export function ThreadDividerLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="underline-offset-2 transition-colors hover:text-foreground hover:underline" onClick={onClick}>
            {children}
        </button>
    )
}
