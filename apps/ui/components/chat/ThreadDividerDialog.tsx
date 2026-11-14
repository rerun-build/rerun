'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { type ComponentType, type ReactNode } from 'react'

// What a thread divider keeps one click away: the guide or prompt the run was started with.
export function ThreadDividerDialog({ open, onOpenChange, icon, title, aside, children }: { open: boolean; onOpenChange: (open: boolean) => void; icon: ComponentType<{ className?: string }>; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent aria-describedby={undefined} className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-2xl">
                <DialogHeaderBar icon={icon} title={title} actions={aside} />
                <div className="overflow-y-auto p-4 text-sm">{children}</div>
            </DialogContent>
        </Dialog>
    )
}
