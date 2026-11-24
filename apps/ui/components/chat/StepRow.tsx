'use client'

import { TextShimmer } from '@rerun/ui'
import { brandIconFilter } from '@rerun/ui/brand-icon'
import { useState, type ReactNode } from 'react'

import type { ToolIconProps } from '@/hooks/useToolDisplay'
import { ChevronRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export type StepStatus = 'done' | 'error' | 'running'

export function StepGlyph({ iconProps, className }: { iconProps: ToolIconProps; className?: string }) {
    const Svg = iconProps.icon
    if (!Svg) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={iconProps.src} alt="" className={cn('size-3.5 shrink-0 object-contain', className)} style={{ filter: brandIconFilter(iconProps.src) }} />
    }
    return <Svg className={cn('size-3.5 shrink-0', className)} />
}

type StepRowProps = {
    iconProps: ToolIconProps
    label: string
    detail?: string
    status: StepStatus
    elapsed?: ReactNode
    children?: ReactNode
}

/** One step of an agent's work on a single 28px line, which opens on what went in and what came out. */
export function StepRow({ iconProps, label, detail, status, elapsed, children }: StepRowProps) {
    const [open, setOpen] = useState(false)
    const expandable = !!children
    return (
        <div>
            <button type="button" disabled={!expandable} onClick={() => setOpen(!open)} className="group/step flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-start text-xs transition-colors enabled:hover:bg-muted/60">
                <StepGlyph iconProps={iconProps} className="text-muted-foreground" />
                <span className={cn('max-w-[60%] shrink-0 truncate font-medium', status === 'error' && 'text-red-500')}>{status === 'running' ? <TextShimmer className="text-xs">{label}</TextShimmer> : label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>
                {elapsed}
                {expandable && <ChevronRightIcon className={cn('size-3 shrink-0 text-muted-foreground opacity-0 transition group-hover/step:opacity-100', open && 'rotate-90 rtl:-rotate-90 opacity-100')} />}
            </button>
            {open && expandable && <div className="mx-1.5 mb-1 space-y-1.5">{children}</div>}
        </div>
    )
}
