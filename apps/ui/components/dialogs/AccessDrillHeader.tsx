'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeftIcon } from '@/lib/icons'
import type { ReactNode } from 'react'

export function AccessDrillHeader({ leading, title, hint, backLabel, onBack }: { leading?: ReactNode; title: string; hint?: ReactNode; backLabel: string; onBack: () => void }) {
    return (
        <div className="flex items-center gap-3 border-b px-3 py-2.5">
            <Button aria-label={backLabel} variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack}>
                <ChevronLeftIcon className="size-4" />
            </Button>
            {leading}
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{title}</span>
                {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
            </div>
        </div>
    )
}
