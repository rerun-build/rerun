'use client'

import { cn } from '../cn'
import { useState, type ReactNode, type RefObject } from 'react'
import { useScrollFade } from './use-scroll-fade'

type ScrollFadeProps = {
    className?: string
    fadeSize?: number
    pinBottom?: boolean
    scrollRef?: RefObject<HTMLDivElement | null>
    children: ReactNode
}

export function ScrollFade({ className, fadeSize = 24, pinBottom = false, scrollRef, children }: ScrollFadeProps) {
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    const mask = useScrollFade(element, { fadeSize, pinBottom })

    return (
        <div
            ref={node => {
                setElement(node)
                if (scrollRef) scrollRef.current = node
            }}
            className={cn('overflow-y-auto', className)}
            style={{ maskImage: mask, WebkitMaskImage: mask }}
        >
            <div>{children}</div>
        </div>
    )
}
