'use client'

import { ChevronDownIcon, ChevronUpIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Markdown } from '@rerun/ui/markdown'
import { Badge } from '@rerun/ui/primitives'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

const COLLAPSED_HEIGHT = 208

// The shared prose styles are sized for the landing page; in a 420px column the headings have to
// come back down to the panel's own scale.
const COMPACT_PROSE = 'break-words text-xs leading-relaxed text-muted-foreground [&>*:first-child]:mt-0 [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-xs [&_p:not(:first-child)]:mt-2 [&_ul]:mt-2 [&_ol]:mt-2 [&_blockquote]:mt-2'

export function TemplateDetailAbout({ content }: { content: string }) {
    const t = useTranslations('templates.about')
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

    const overflows = contentHeight > COLLAPSED_HEIGHT
    const collapsed = overflows && !expanded

    return (
        <div className="flex flex-col">
            <div
                className={cn('overflow-hidden transition-[max-height] duration-300 ease-out', collapsed && '[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]')}
                style={{ maxHeight: overflows ? (collapsed ? COLLAPSED_HEIGHT : contentHeight) : COLLAPSED_HEIGHT }}
            >
                <div ref={contentRef}>
                    <Markdown content={content} className={COMPACT_PROSE} />
                </div>
            </div>
            {overflows && (
                <button type="button" aria-expanded={expanded} onClick={() => setExpanded(open => !open)} className="mt-2 self-center opacity-80 transition-opacity hover:opacity-100">
                    <Badge tone="neutral" size="xs" glow={false} trailing={expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}>
                        {expanded ? t('showLess') : t('showMore')}
                    </Badge>
                </button>
            )}
        </div>
    )
}
