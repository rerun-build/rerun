'use client'

import { Collapsible, CollapsibleContent, CollapsibleTrigger, ScrollFade, formatElapsed, useElapsed } from '../primitives'
import { cn } from '../cn'
import { BrainIcon, ChevronRightIcon } from '../icons'
import { TextShimmer } from '../TextShimmer'
import { useEffect, useState, type ReactNode } from 'react'
import { useKitTranslations } from '../locale'

export type ReasoningBlockProps = {
    text: string
    streaming?: boolean
    /** A frozen duration, for a scripted transcript that has no live run behind it. */
    seconds?: number
    renderText?: (text: string) => ReactNode
    className?: string
}

/**
 * The model thinking out loud: a header that shimmers while it lasts, and the thought itself in a
 * bordered column that follows the text as it arrives. It folds itself once the thought settles,
 * which the reader can override by hand.
 */
export function ReasoningBlock({ text, streaming = false, seconds, renderText = text => text, className }: ReasoningBlockProps) {
    const [open, setOpen] = useState(streaming)
    useEffect(() => {
        setOpen(streaming)
    }, [streaming])

    const hasText = !!text

    if (!hasText && !streaming) return null

    return (
        <Collapsible open={open && hasText} onOpenChange={setOpen} className={cn('space-y-1.5 px-1.5', className)}>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left text-sm text-muted-foreground">
                <BrainIcon className="size-3.5 shrink-0" />
                <ReasoningHeader streaming={streaming} seconds={seconds} />
                {hasText && <ChevronRightIcon className="ml-auto size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />}
            </CollapsibleTrigger>

            {hasText && (
                <CollapsibleContent>
                    <ScrollFade pinBottom={streaming} className="max-h-40 border-l border-border pl-3 text-xs leading-relaxed text-muted-foreground/80">
                        {renderText(text)}
                    </ScrollFade>
                </CollapsibleContent>
            )}
        </Collapsible>
    )
}

/**
 * Label + chrono. Split out to own the 100ms tick: it re-renders this line alone, never the thought
 * below it. A scripted duration skips the chrono entirely, so a replayed thought does not count up
 * to a number it already knows.
 */
function ReasoningHeader({ streaming, seconds }: { streaming: boolean; seconds?: number }) {
    const t = useKitTranslations()
    const live = useElapsed(streaming && seconds === undefined)
    const elapsed = seconds ?? live

    if (streaming) {
        return (
            <>
                <TextShimmer className="text-sm">{t('chat.reasoning.thinking')}</TextShimmer>
                {live !== undefined && <span className="shrink-0 font-mono text-xs tabular-nums">{formatElapsed(live)}</span>}
            </>
        )
    }

    return <span className="truncate">{elapsed !== undefined ? t('chat.reasoning.thoughtFor', { duration: formatElapsed(elapsed) }) : t('chat.reasoning.thought')}</span>
}
