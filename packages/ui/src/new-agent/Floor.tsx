'use client'

import { type CSSProperties, type ReactNode, useId } from 'react'

import { cn } from '../cn'

const TILE_W = 56
const TILE_H = 28
const DIAMOND = `M ${TILE_W / 2} 0 L ${TILE_W} ${TILE_H / 2} L ${TILE_W / 2} ${TILE_H} L 0 ${TILE_H / 2} Z`

const SIZE = { width: 2000, height: 1600 }

export type FloorLight = { masks: string[]; light: string; dark: string }

export function Floor({ fade, lights = [], className, style }: { fade: string; lights?: FloorLight[]; className?: string; style?: CSSProperties }) {
    return (
        <div aria-hidden className={cn('pointer-events-none absolute left-1/2 -z-10 -translate-x-1/2 -translate-y-1/2', className)} style={{ ...SIZE, ...style }}>
            <Masked masks={[fade]}>
                <Lines stroke="rgb(var(--iso-glint) / 0.07)" />
            </Masked>
            {lights.map((light, index) => (
                <Masked key={index} masks={light.masks}>
                    <Lines stroke={light.light} className="dark:hidden" />
                    <Lines stroke={light.dark} className="hidden dark:block" />
                </Masked>
            ))}
        </div>
    )
}

function Masked({ masks, children }: { masks: string[]; children: ReactNode }) {
    return masks.reduceRight<ReactNode>(
        (inner, mask) => (
            <div className="absolute inset-0" style={{ maskImage: mask }}>
                {inner}
            </div>
        ),
        children
    )
}

function Lines({ stroke, className }: { stroke: string; className?: string }) {
    const id = `floor${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
    return (
        <svg className={cn('absolute inset-0 size-full', className)}>
            <defs>
                <pattern id={id} width={TILE_W} height={TILE_H} x="50%" y="50%" patternUnits="userSpaceOnUse">
                    <path d={DIAMOND} fill="none" strokeWidth={1} style={{ stroke }} />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id})`} />
        </svg>
    )
}
