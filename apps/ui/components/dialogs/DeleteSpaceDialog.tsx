'use client'

import { useEffect, useState } from 'react'

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
import { Input } from '@/components/ui/input'
import { useCanManageSpace } from '@/hooks/useBoxAccess'
import { useTranslations } from 'next-intl'

type DeleteSpaceDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    spaceName?: string
    agentCount: number
    // The Box being deleted: the dialog does not open for one the caller does not manage.
    spaceId?: string
}

export function DeleteSpaceDialog({ open, onOpenChange, onConfirm, spaceName, agentCount, spaceId }: DeleteSpaceDialogProps) {
    const t = useTranslations('dialogs.deleteBox')
    const tCommon = useTranslations('common')
    const [confirmText, setConfirmText] = useState('')
    const canManage = useCanManageSpace(spaceId)
    const refused = !!spaceId && !canManage

    useEffect(() => {
        if (!open) setConfirmText('')
    }, [open])

    const holdsAgents = agentCount > 0
    const canDelete = !holdsAgents && (!spaceName || confirmText.trim() === spaceName)

    return (
        <AlertDialog open={open && !refused} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {holdsAgents ? t('holdsCoworkers', { count: agentCount }) : t('description')}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {spaceName && !holdsAgents && (
                    <div className="grid gap-2">
                        <p className="text-sm text-muted-foreground">
                            {t.rich('typeToConfirm', { name: spaceName, strong: chunks => <span className="font-medium text-foreground">{chunks}</span> })}
                        </p>
                        <Input
                            value={confirmText}
                            onChange={e => setConfirmText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && canDelete) onConfirm()
                            }}
                            placeholder={spaceName}
                            autoFocus
                        />
                    </div>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onConfirm} disabled={!canDelete}>
                        {t('confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
