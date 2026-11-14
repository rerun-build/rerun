'use client'

import { DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

export function PanelDialogContent({ className, children, ...props }: ComponentProps<typeof DialogContent>) {
    return (
        <DialogContent
            className={cn('flex flex-col gap-0 overflow-hidden p-0 max-sm:h-[85dvh] sm:h-[min(40rem,88dvh)] sm:max-w-3xl', className)}
            onOpenAutoFocus={event => event.preventDefault()}
            {...props}
        >
            <div className="flex min-h-0 flex-1 flex-col max-sm:pb-[env(safe-area-inset-bottom)]">{children}</div>
        </DialogContent>
    )
}
