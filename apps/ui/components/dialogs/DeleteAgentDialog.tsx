'use client'

import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxAccessCopy } from '@/components/dialogs/access-person'
import { useBoardStore } from '@/stores/board.store'

type DeleteAgentDialogProps = {
    agentId: string
    agentName?: string
    children?: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

export function DeleteAgentDialog({ agentId, agentName, children, open: controlledOpen, onOpenChange }: DeleteAgentDialogProps) {
    const t = useTranslations('dialogs.deleteAgent')
    const tCommon = useTranslations('common')
    const { manageReason } = useBoxAccessCopy()
    const removeAgent = useBoardStore(s => s.removeAgent)
    const selectAgent = useBoardStore(s => s.selectAgent)
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    const [confirmText, setConfirmText] = useState('')
    const open = controlledOpen ?? uncontrolledOpen
    const canManage = useCanManageAgent(agentId)

    const canDelete = canManage && (!agentName || confirmText.trim() === agentName)

    const handleOpenChange = (next: boolean) => {
        if (controlledOpen === undefined) setUncontrolledOpen(next)
        onOpenChange?.(next)
        if (!next) setConfirmText('')
    }

    const handleDelete = () => {
        removeAgent(agentId)
        selectAgent(null)
        handleOpenChange(false)
    }

    return (
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
            {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('description')}</AlertDialogDescription>
                </AlertDialogHeader>
                {agentName && (
                    <div className="grid gap-2">
                        <p className="text-sm text-muted-foreground">{t.rich('typeToConfirm', { name: agentName, b: chunks => <span className="font-medium text-foreground">{chunks}</span> })}</p>
                        <Input
                            value={confirmText}
                            onChange={e => setConfirmText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && canDelete) handleDelete()
                            }}
                            placeholder={agentName}
                            autoFocus
                        />
                    </div>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                    <TooltipDisabledReason reason={canManage ? undefined : manageReason}>
                        <AlertDialogAction onClick={handleDelete} variant="destructive" disabled={!canDelete}>{t('confirm')}</AlertDialogAction>
                    </TooltipDisabledReason>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
