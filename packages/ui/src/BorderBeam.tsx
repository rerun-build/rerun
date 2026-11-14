import type { CSSProperties } from 'react'
import { clsx } from 'clsx'

export interface BorderBeamProps {
    pattern?: 'ring' | 'arcs'
    tone?: 'brand' | 'white' | 'neutral' | 'green' | 'red' | 'orange' | 'cyan' | 'yellow'
    animated?: boolean
    glow?: boolean
    width?: number
    duration?: number
    angle?: number
    radius?: string
    outset?: number
    className?: string
    style?: CSSProperties
}

export function BorderBeam({
    pattern = 'arcs',
    tone = 'neutral',
    animated = false,
    glow = false,
    width = 1,
    duration = 6,
    angle = 220,
    radius = 'inherit',
    outset = 0,
    className,
    style,
}: BorderBeamProps) {
    return (
        <span
            aria-hidden
            className={clsx(
                'border-beam',
                `border-beam--${pattern}`,
                `border-beam--${tone}`,
                animated && 'border-beam--spin',
                glow && 'border-beam--glow',
                className,
            )}
            style={
                {
                    borderRadius: radius,
                    '--beam-w': `${width}px`,
                    '--beam-outset': `${outset}px`,
                    '--beam-dur': `${duration}s`,
                    ...(animated ? {} : { '--border-beam-angle': `${angle}deg` }),
                    ...style,
                } as CSSProperties
            }
        />
    )
}
