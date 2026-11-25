'use client'

import { cn } from '@/lib/utils'
import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// Room over the window for the Chief of Staff peeking over it.
const HEADROOM = 72

// A piece of the app drawn at its own pixel size, then scaled down to what the panel leaves it, never
// up past `maxScale`. Only a picture: out of reach of the pointer, the keyboard and assistive tech.
// `controls` are laid over it and stay live.
export function PanelStage({ width, height, maxScale = 1, accent, controls, float = true, children }: { width: number; height: number; maxScale?: number; accent?: ReactNode; controls?: ReactNode; float?: boolean; children: ReactNode }) {
    const room = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState<number | null>(null)
    const headroom = accent ? HEADROOM : 0

    useLayoutEffect(() => {
        const element = room.current
        if (!element) return
        const fit = () => setScale(Math.min(maxScale, element.clientWidth / width, (element.clientHeight - headroom) / height))
        const observer = new ResizeObserver(fit)
        observer.observe(element)
        fit()
        return () => observer.disconnect()
    }, [width, height, maxScale, headroom])

    return (
        <div ref={room} className="flex h-full items-center justify-center" style={{ paddingTop: headroom }}>
            {scale !== null && scale > 0 && (
                <div className="relative shrink-0" style={{ width: width * scale, height: height * scale }}>
                    {accent}
                    {controls}
                    <motion.div inert aria-hidden className="relative z-10" animate={float ? { y: [0, -6, 0] } : undefined} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}>
                        <div className="origin-top-left rtl:origin-top-right" style={{ width, height, transform: `scale(${scale})` }}>
                            {children}
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    )
}

// A window of the app: the popover surface every dialog and panel is drawn on.
export function PanelWindow({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cn('flex h-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-2xl shadow-black/30 ring-1 ring-foreground/10', className)}>{children}</div>
}
