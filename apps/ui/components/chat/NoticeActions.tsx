'use client'

import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { ArrowRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type NoticeAction = { key: string; leading: ReactNode; title: string; description: string; cta: string; variant?: 'default' | 'outline'; onClick: () => void }

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
                    <Button size="sm" variant={action.variant ?? (index === 0 ? 'default' : 'outline')} onClick={action.onClick} className={cn('shrink-0', stacked ? 'mt-auto w-full' : 'ml-auto')}>
                        {action.cta}
                        <ArrowRightIcon className="size-3.5" />
                    </Button>
                </div>
            ))}
        </div>
    )
}
