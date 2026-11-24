'use client'

import { Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, IconBadge } from '../primitives'
import { BorderBeam } from '../BorderBeam'
import { cn } from '../cn'
import { CheckIcon, ChevronRightIcon, WrenchIcon, XIcon, type LucideIcon } from '../icons'
import { useState, type ReactNode } from 'react'

export type ToolCallStatus = 'running' | 'done' | 'error'

export type ToolCallRowProps = {
    label: string
    icon?: LucideIcon
    /** A brand logo URL, for the surfaces that name the connector rather than the tool. */
    iconSrc?: string
    status: ToolCallStatus
    elapsed?: ReactNode
    /** A muted second line under the label, for a call whose progress is worth reading while folded. */
    summary?: ReactNode
    /** Controls the fold from outside. Left out, the row keeps its own state and starts folded. */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children?: ReactNode
    className?: string
}

function StatusIndicator({ status }: { status: ToolCallStatus }) {
    if (status === 'running') return <IconBadge tone="brand" animated />
    if (status === 'error') return <IconBadge tone="red" icon={XIcon} />
    return <IconBadge tone="green" icon={CheckIcon} />
}

/**
 * One tool call in a transcript: the row you can fold open, plus whatever the caller wants to show
 * underneath. It starts folded, even while the call runs, so raw commands and payloads only show when
 * the reader asks for them.
 */
export function ToolCallRow({ label, icon, iconSrc, status, elapsed, summary, open: openProp, onOpenChange, children, className }: ToolCallRowProps) {
    const running = status === 'running'
    const [ownOpen, setOwnOpen] = useState(false)
    const open = openProp ?? ownOpen
    const setOpen = onOpenChange ?? setOwnOpen

    const hasContent = !!children

    return (
        <Collapsible open={open && hasContent} onOpenChange={setOpen} className={cn('relative rounded-xl transition-colors data-[state=open]:bg-muted/40', className)}>
            {running && <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={5} />}
            <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-xl px-1.5 py-1.5 text-start text-sm transition-colors data-[state=closed]:hover:bg-muted/40">
                {iconSrc ? <Icon size="sm" src={iconSrc} /> : <Icon size="sm" icon={icon ?? WrenchIcon} />}
                <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{label}</span>
                    {summary && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
                </div>
                {elapsed}
                <StatusIndicator status={status} />
                {hasContent && <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 rtl:group-data-[state=open]:-rotate-90" />}
            </CollapsibleTrigger>

            {hasContent && (
                <CollapsibleContent>
                    <div className="mx-1.5 space-y-2 border-t border-border/60 px-1.5 pt-2 pb-3">{children}</div>
                </CollapsibleContent>
            )}
        </Collapsible>
    )
}
