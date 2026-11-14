'use client'

import type { ComponentProps, ReactNode } from 'react'
import { DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function SplitDialogContent({ aside, className, gridClassName, children, ...props }: ComponentProps<typeof DialogContent> & { aside: ReactNode; gridClassName?: string }) {
    return (
        <DialogContent className={cn('gap-0 overflow-hidden p-0 sm:max-w-[min(80rem,100%_-_4rem)] [&_[data-slot=dialog-footer]]:rounded-none', className)} {...props}>
            <div className={cn('flex min-h-0 flex-col sm:grid sm:h-[min(48rem,90dvh)] sm:grid-cols-2 sm:grid-rows-[minmax(0,1fr)]', gridClassName)}>
                {children}
                {aside}
            </div>
        </DialogContent>
    )
}
