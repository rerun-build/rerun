'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { CopyChip } from '@/components/dialogs/CopyChip'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'

type DeleteWorkspaceDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; name: string; onConfirm: () => void }

export function DeleteWorkspaceDialog({ open, onOpenChange, name, onConfirm }: DeleteWorkspaceDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">{open && <DeleteWorkspaceForm name={name} onConfirm={onConfirm} onClose={() => onOpenChange(false)} />}</AlertDialogContent>
        </AlertDialog>
    )
}

function DeleteWorkspaceForm({ name, onConfirm, onClose }: { name: string; onConfirm: () => void; onClose: () => void }) {
    const t = useTranslations('organization.danger.deleteConfirm')
    const tCommon = useTranslations('common')
    const [typed, setTyped] = useState('')
    const input = useRef<HTMLInputElement>(null)
    const confirmed = typed.trim() === name.trim()
    return (
        <>
            <AlertDialogHeader>
                <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                <AlertDialogDescription>{t('description')}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid min-w-0 gap-2">
                <p className="min-w-0 text-sm break-words text-muted-foreground">{t.rich('type', { strong: () => <CopyChip value={name} pasteTarget={input} /> })}</p>
                <Input
                    ref={input}
                    autoFocus
                    aria-label={name}
                    value={typed}
                    onChange={event => setTyped(event.target.value)}
                    onKeyDown={event => {
                        if (event.key !== 'Enter' || !confirmed) return
                        onConfirm()
                        onClose()
                    }}
                />
            </div>
            <AlertDialogFooter>
                <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={!confirmed} onClick={onConfirm}>
                    {t('confirm')}
                </AlertDialogAction>
            </AlertDialogFooter>
        </>
    )
}
