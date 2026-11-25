'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { LockIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

// A window on a screen of the product, as a client sees it.
export function Browser({ address, children, className }: { address: string; children: ReactNode; className?: string }) {
    return (
        <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl bg-card shadow-md ring-1 ring-border', className)}>
            <div className="flex h-8 shrink-0 items-center justify-center gap-1.5 border-b border-border px-3 text-[11px] text-muted-foreground">
                <LockIcon className="size-3 shrink-0" />
                <span className="truncate">{address}</span>
            </div>
            {children}
        </div>
    )
}

type ScaledFrameProps = { title: string; width: number; src?: string; srcDoc?: string; sandbox?: string; className?: string; onFrame?: (frame: HTMLIFrameElement | null) => void }

// Laid out at the width it is made for, and scaled down to the room it has. Nothing in it can be used.
export function ScaledFrame({ title, width, className, onFrame, ...source }: ScaledFrameProps) {
    const ref = useRef<HTMLDivElement>(null)
    const [shown, setShown] = useState<number | null>(null)
    useEffect(() => {
        const element = ref.current
        if (!element) return
        const observer = new ResizeObserver(([entry]) => setShown(entry.contentRect.width))
        observer.observe(element)
        return () => observer.disconnect()
    }, [])
    return (
        <div ref={ref} inert dir="ltr" className={cn('relative overflow-hidden bg-background', className)}>
            {!!shown && <iframe ref={onFrame} title={title} {...source} loading="lazy" tabIndex={-1} className="absolute top-0 left-0 origin-top-left" style={{ width, height: `${(width / shown) * 100}%`, transform: `scale(${shown / width})` }} />}
        </div>
    )
}
