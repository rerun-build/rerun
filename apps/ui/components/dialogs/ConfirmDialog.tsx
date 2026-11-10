'use client'

import { useState, type ComponentProps, type MouseEvent, type ReactNode } from 'react'

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

type ConfirmDialogBaseProps = {
    title: string
    description?: ReactNode
    confirmLabel?: string
    cancelLabel?: string
    confirmVariant?: ComponentProps<typeof Button>['variant']
    pending?: boolean
    onConfirm: (event: MouseEvent<HTMLButtonElement>) => void
}

// Le mode contrôlé existe pour les triggers qui vivent dans un calque qui se ferme sur
// interact-outside (Popover, DropdownMenu) : la dialog doit alors être montée en dehors.
type ConfirmDialogProps = ConfirmDialogBaseProps &
    (
        | { children: ReactNode; open?: undefined; onOpenChange?: undefined }
        | { children?: undefined; open: boolean; onOpenChange: (open: boolean) => void }
    )

export function ConfirmDialog({
    title,
    description,
    confirmLabel,
    cancelLabel,
    confirmVariant = 'destructive',
    pending = false,
    onConfirm,
    children,
    open,
    onOpenChange,
}: ConfirmDialogProps) {
    const t = useTranslations('dialogs.confirm')
    const tCommon = useTranslations('common')
    const [selfOpen, setSelfOpen] = useState(false)
    const controlled = onOpenChange !== undefined

    return (
        <AlertDialog open={controlled ? open : selfOpen} onOpenChange={controlled ? onOpenChange : setSelfOpen}>
            {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{cancelLabel ?? tCommon('cancel')}</AlertDialogCancel>
                    <AlertDialogAction variant={confirmVariant} disabled={pending} onClick={onConfirm}>
                        {confirmLabel ?? t('confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
