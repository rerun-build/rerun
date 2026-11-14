'use client'

import type { ReactNode } from 'react'

import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type DesktopDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    children: ReactNode
}

export function DesktopDialog({ open, onOpenChange, title, description, children }: DesktopDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent
                className="sm:h-[calc(100dvh-6rem)] sm:max-w-[calc(100vw-6rem)]"
                showCloseButton={false}
                onEscapeKeyDown={event => event.preventDefault()}
            >
                <DialogHeader className="sr-only">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {children}
            </PanelDialogContent>
        </Dialog>
    )
}
