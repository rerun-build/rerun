'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { cn } from '../cn'
import { Maximize2Icon, RefreshCw, X } from '../icons'
import { useKitControls, type KitBackdrop } from './KitControls'

const CHECKER: CSSProperties = {
    backgroundImage: 'repeating-conic-gradient(color-mix(in oklch, var(--foreground) 10%, transparent) 0% 25%, transparent 0% 50%)',
    backgroundSize: '16px 16px',
}

function backdropStyle(backdrop: KitBackdrop) {
    return backdrop === 'checker' ? CHECKER : undefined
}

function backdropClass(backdrop: KitBackdrop) {
    if (backdrop === 'plain') return 'bg-background'
    if (backdrop === 'checker') return ''
    return 'bg-card'
}

/**
 * One element of the gallery, framed and ready to be filmed. `zoom` is used rather than a transform
 * because it reflows: the frame grows with the element instead of letting it spill out of a clipped
 * box, which is what a designer wants when reading a 4x icon.
 */
export function KitStage({
    id,
    name,
    note,
    backdrop,
    scale,
    replay = false,
    bare = false,
    className,
    children,
}: {
    id: string
    name?: string
    note?: string
    backdrop?: KitBackdrop
    scale?: number
    replay?: boolean
    /** Drops the frame's padding, for a child that paints to the edge or brings its own. */
    bare?: boolean
    className?: string
    children: ReactNode
}) {
    const controls = useKitControls()
    const [run, setRun] = useState(0)

    const resolvedBackdrop = backdrop ?? controls.backdrop
    const resolvedScale = scale ?? controls.scale
    const soloed = controls.solo === id

    useEffect(() => {
        if (!soloed) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') controls.setSolo(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [soloed, controls])

    // `zoom` rather than a transform: it reflows, so the frame grows with the element instead of
    // letting it spill out of a clipped box. A scaled box also has to carry its own centring, since
    // the flex parent measures it before the zoom applies.
    const body = (
        <div key={run} style={resolvedScale === 1 ? undefined : ({ zoom: resolvedScale } as CSSProperties)} className={bare ? 'size-full' : 'm-auto w-fit'}>
            {children}
        </div>
    )

    if (soloed) {
        return (
            <div
                data-kit-solo={id}
                style={backdropStyle(resolvedBackdrop)}
                // Above the site chrome, not just above the page: a capture surface that still has a
                // cookie banner and a support bubble on it is not a capture surface.
                className={cn('fixed inset-0 z-9999 flex items-center justify-center overflow-auto p-10', resolvedBackdrop === 'checker' ? 'bg-background' : backdropClass(resolvedBackdrop))}
            >
                {body}
                <div className="fixed top-4 end-4 z-10 flex items-center gap-2">
                    {replay && <StageButton icon={<RefreshCw className="size-3" />} label="Replay" onClick={() => setRun(value => value + 1)} />}
                    <StageButton icon={<X className="size-3" />} label="Close" onClick={() => controls.setSolo(null)} />
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <div
                id={id}
                style={backdropStyle(resolvedBackdrop)}
                className={cn('group/stage relative flex scroll-mt-24 items-center justify-center overflow-hidden rounded-xl border border-border', backdropClass(resolvedBackdrop), bare ? '' : 'p-6', className)}
            >
                {body}
                <div className="absolute top-2 end-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/stage:opacity-100 focus-within:opacity-100">
                    {replay && <StageButton icon={<RefreshCw className="size-3" />} label="Replay" onClick={() => setRun(value => value + 1)} />}
                    <StageButton icon={<Maximize2Icon className="size-3" />} label="Solo" onClick={() => controls.setSolo(id)} />
                </div>
            </div>
            {(name || note) && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {name && <span className="font-mono text-[11px] text-foreground/40">{name}</span>}
                    {note && <span className="text-[11px] text-foreground/30">{note}</span>}
                </div>
            )}
        </div>
    )
}

function StageButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2 py-1 font-mono text-[11px] text-foreground/60 backdrop-blur-sm transition-colors hover:text-foreground"
        >
            {icon}
            {label}
        </button>
    )
}
