'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { type ReactNode } from 'react'

export function ThreadDividerDialog({ open, onOpenChange, icon, title, aside, children }: { open: boolean; onOpenChange: (open: boolean) => void; icon: ReactNode; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent aria-describedby={undefined} className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-2xl">
                <div className="flex shrink-0 items-center gap-2 border-b border-border py-3 pr-12 pl-4">
                    {icon}
                    <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{title}</DialogTitle>
                    {aside}
                </div>
                <div className="overflow-y-auto px-5 py-4 text-sm">{children}</div>
            </DialogContent>
        </Dialog>
    )
}
