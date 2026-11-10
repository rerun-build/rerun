'use client'

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTranslations } from 'next-intl'

type ClearMemoriesDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
}

export function ClearMemoriesDialog({ open, onOpenChange, onConfirm }: ClearMemoriesDialogProps) {
    const t = useTranslations('dialogs.clearMemories')
    const tCommon = useTranslations('common')
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('description')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onConfirm}>
                        {t('confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
