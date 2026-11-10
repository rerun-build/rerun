'use client'

import { useEffect, useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { DELETE_ACCOUNT_CONFIRMATION } from '@/lib/auth/account-deletion'
import { Loader2Icon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

export function DeleteAccountDialog({ open, pending, onOpenChange, onConfirm }: { open: boolean; pending: boolean; onOpenChange: (open: boolean) => void; onConfirm: (confirmation: string) => void }) {
    const t = useTranslations('dialogs.deleteAccount')
    const tCommon = useTranslations('common')
    const [confirmText, setConfirmText] = useState('')

    useEffect(() => {
        if (!open) setConfirmText('')
    }, [open])

    const canDelete = !pending && confirmText.trim() === DELETE_ACCOUNT_CONFIRMATION

    return (
        <AlertDialog open={open} onOpenChange={next => !pending && onOpenChange(next)}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('description')}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="grid gap-2">
                    <p className="text-sm text-muted-foreground">
                        {t.rich('typeToConfirm', { word: DELETE_ACCOUNT_CONFIRMATION, strong: chunks => <span className="font-medium text-foreground">{chunks}</span> })}
                    </p>
                    <Input
                        value={confirmText}
                        onChange={event => setConfirmText(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && canDelete) onConfirm(confirmText)
                        }}
                        placeholder={DELETE_ACCOUNT_CONFIRMATION}
                        autoComplete="off"
                        disabled={pending}
                        autoFocus
                    />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{tCommon('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={!canDelete}
                        onClick={event => {
                            event.preventDefault()
                            onConfirm(confirmText)
                        }}
                    >
                        {pending && <Loader2Icon className="animate-spin" />}
                        {t('confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
