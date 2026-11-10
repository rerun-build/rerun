'use client'

import type { ReactNode } from 'react'
import type { TableCard } from '@rerun/contracts'

import { cn } from '../../cn'
import { DatabaseIcon } from '../../icons'
import { Badge, Button } from '../../primitives'
import { TooltipDisabledReason } from '../../Tooltip'
import { useKitTranslations } from '../../locale'

export type TableCardFrameProps = {
    card: Pick<TableCard, 'table' | 'scope' | 'total' | 'columnsTruncated'>
    onOpen?: () => void
    openDisabledReason?: string
    noun?: string
    /** Appended to the row count, e.g. what a board is grouped by. */
    footerNote?: string
    className?: string
    children: ReactNode
}

/** The header and footer every layout shares, so only the body changes from one layout to the next. */
export function TableCardFrame({ card, onOpen, openDisabledReason, noun, footerNote, className, children }: TableCardFrameProps) {
    const t = useKitTranslations()
    const count = noun ? `${card.total} ${noun}` : t('chat.table.rows', { count: card.total })
    const footer = [count, card.columnsTruncated && t('chat.table.columnsHidden'), footerNote].filter(Boolean).join(' · ')

    return (
        <div className={cn('overflow-hidden rounded-[20px] bg-muted', className)}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{card.table}</span>
                <Badge size="sm" tone={card.scope === 'shared' ? 'cyan' : 'neutral'}>
                    {card.scope === 'shared' ? t('chat.table.boxDatabase') : t('chat.table.coworkerDatabase')}
                </Badge>
            </div>
            {children}
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5">
                <span className="text-[11px] tabular-nums text-muted-foreground">
                    {footer}
                </span>
                {(onOpen || openDisabledReason) && (
                    <TooltipDisabledReason reason={onOpen ? undefined : openDisabledReason}>
                        <Button size="sm" variant="ghost" disabled={!onOpen} onClick={() => onOpen?.()}>
                            {t('chat.table.open')}
                        </Button>
                    </TooltipDisabledReason>
                )}
            </div>
        </div>
    )
}

export function EmptyRows() {
    const t = useKitTranslations()
    return <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('chat.table.empty')}</p>
}
