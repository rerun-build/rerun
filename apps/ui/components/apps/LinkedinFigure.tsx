'use client'

import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { approve } from '@/lib/hairline/approve'
import { mountFigure } from '@/lib/hairline/mount-figure'
import { cn } from '@/lib/utils'

const ON_POPOVER = { '--hairline-plate': 'var(--popover)' } as CSSProperties

export function LinkedinApproveFigure({ label, className }: { label: string; className?: string }) {
    const ref = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        if (!ref.current) return
        return mountFigure(ref.current, approve, { play: true })
    }, [])
    return <div ref={ref} role="img" aria-label={label} style={ON_POPOVER} className={cn('aspect-[5/4] w-full', className)} />
}
