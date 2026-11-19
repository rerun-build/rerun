'use client'

import type { ReactNode } from 'react'
import { BorderBeam, type BorderBeamProps } from '@moldwright/ui'
import { ChromeBar } from '@moldwright/ui/chrome'

import { cn } from '@/lib/utils'

export type ForemanPillSide = 'left' | 'right'

type ForemanPillProps = {
    side: ForemanPillSide
    width: string
    tone?: BorderBeamProps['tone']
    hidden?: boolean
    children: ReactNode
}

export function ForemanPill({ side, width, tone, hidden = false, children }: ForemanPillProps) {
    return (
        <ChromeBar
            start={side === 'left' ? 'control' : 'text'}
            end={side === 'left' ? 'text' : 'control'}
            beamTone={tone ? 'white' : 'brand'}
            beamAnimated={!tone && !hidden}
            inert={hidden}
            className={cn(
                'pointer-events-auto absolute top-1/2 -translate-y-1/2 gap-0 font-normal transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none',
                side === 'left' ? 'left-0 pl-[66px]' : 'right-0 pr-[60px]',
                width,
                hidden && 'pointer-events-none opacity-0'
            )}
        >
            {tone && <BorderBeam pattern="arcs" tone={tone} animated glow angle={53} outset={1} className="opacity-60" />}
            {children}
        </ChromeBar>
    )
}
