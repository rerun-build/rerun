'use client'

import { AgentWorkspaceMessage } from '@/components/chat/AgentWorkspaceMessage'
import type { ComposerMention } from '@/lib/chat/composer-links'
import { ChevronDownIcon, ChevronUpIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

const COLLAPSED_HEIGHT = 384

type ExpandableMessageProps = {
    agentId?: string
    mentions?: ComposerMention[]
    children: string
}

/** A user message taller than the cap ends in a fade and opens on a centred pill. */
export function ExpandableMessage({ agentId, mentions, children }: ExpandableMessageProps) {
    const t = useTranslations('chat.message')
    const contentRef = useRef<HTMLDivElement>(null)
    const [contentHeight, setContentHeight] = useState(0)
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        const el = contentRef.current
        if (!el) return
        const measure = () => setContentHeight(el.offsetHeight)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // Zero until the first measure: the message opens flush rather than flashing a fade it does not need.
    const overflows = contentHeight > COLLAPSED_HEIGHT
    const collapsed = overflows && !expanded

    return (
        <div className="flex flex-col">
            <div
                className={cn('overflow-hidden transition-[max-height] duration-300 ease-out', collapsed && '[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]')}
                style={{ maxHeight: overflows ? (collapsed ? COLLAPSED_HEIGHT : contentHeight) : undefined }}
            >
                <div ref={contentRef}>
                    <AgentWorkspaceMessage agentId={agentId} composerTokens mentions={mentions}>
                        {children}
                    </AgentWorkspaceMessage>
                </div>
            </div>
            {overflows && (
                <button type="button" aria-expanded={expanded} onClick={() => setExpanded(open => !open)} className="mt-2 self-center opacity-80 transition-opacity hover:opacity-100">
                    <Badge tone="white" size="xs" className="[--badge-fg:#fff]! [--badge-soft:rgba(255,255,255,0.12)]!" trailing={expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}>
                        {expanded ? t('showLess') : t('showMore')}
                    </Badge>
                </button>
            )}
        </div>
    )
}
