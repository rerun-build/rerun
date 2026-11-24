'use client'

import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { ArrowRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type NoticeAction = { key: string; leading: ReactNode; title: string; description: string; cta: string; variant?: 'default' | 'outline'; onClick: () => void }

// The way out of a chat notice, as cells rather than a row of small buttons. "Switch model" sitting
// in the corner was the only door to plugging in a Claude or ChatGPT plan, and nobody read it that
// way: a cell has room for the icons of what it connects and a line saying what happens next.
//
// The cell itself is not the button. A whole clickable cell read as an info box, so the move is
// carried by a real Button, the first one filled and the rest outlined, which also says which
// way out the notice recommends.
//
// Two actions share the width and stack their text under the icon, the button closing the column;
// a lone action would leave that layout half empty, so it lies down on one row instead, its button
// dropping under the text when a narrow panel has no room for both.
export function NoticeActions({ actions }: { actions: NoticeAction[] }) {
    if (actions.length === 0) return null
    const stacked = actions.length > 1

    return (
        <div className={cn('grid gap-2', stacked && 'grid-cols-2')}>
            {actions.map((action, index) => (
                <div key={action.key} className={cn('flex p-3', stacked ? 'flex-col gap-2' : 'flex-wrap items-center gap-3', PANEL_CARD)}>
                    {action.leading}
                    <span className={cn('flex min-w-0 flex-1 flex-col gap-1', !stacked && 'basis-48')}>
                        <span className="block text-sm font-medium">{action.title}</span>
                        <span className="text-xs text-muted-foreground">{action.description}</span>
                    </span>
                    <Button size="sm" variant={action.variant ?? (index === 0 ? 'default' : 'outline')} onClick={action.onClick} className={cn('shrink-0', stacked ? 'mt-auto w-full' : 'ms-auto')}>
                        {action.cta}
                        <ArrowRightIcon className="size-3.5" />
                    </Button>
                </div>
            ))}
        </div>
    )
}
