'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ArchiveIcon, ArrowLeftIcon, EllipsisIcon, RotateCwIcon, Trash2Icon, type LucideIcon } from '@/lib/icons'

import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog'

export type LifecycleAction = 'archive' | 'restore' | 'delete'

type Confirmation = 'restart' | 'archive' | 'delete'

type WorkspaceMenuProps = {
    name: string
    // Put away already: it is restored from the button next to this menu.
    archived: boolean
    busy: boolean
    reasons: { restart?: string; takeBack?: string; lifecycle?: string }
    onRestart: () => void
    onTakeBack: () => void
    onArchive: () => void
    onDelete: () => void
}

export function WorkspaceMenu({ name, archived, busy, reasons, onRestart, onTakeBack, onArchive, onDelete }: WorkspaceMenuProps) {
    const t = useTranslations('organization')
    const [confirming, setConfirming] = useState<Confirmation | null>(null)
    const close = (open: boolean) => !open && setConfirming(null)
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label={t('detail.more')} loading={busy}>
                        <EllipsisIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                    <MenuItem icon={RotateCwIcon} label={t('machine.restart')} reason={reasons.restart} onSelect={() => setConfirming('restart')} />
                    <MenuItem icon={ArrowLeftIcon} label={t('credit.takeBack')} reason={reasons.takeBack} onSelect={onTakeBack} />
                    <DropdownMenuSeparator />
                    {!archived && <MenuItem icon={ArchiveIcon} label={t('danger.archive')} reason={reasons.lifecycle} onSelect={() => setConfirming('archive')} />}
                    <MenuItem destructive icon={Trash2Icon} label={t('danger.delete')} reason={reasons.lifecycle} onSelect={() => setConfirming('delete')} />
                </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog open={confirming === 'restart'} onOpenChange={close} title={t('machine.restartConfirm.title')} description={t('machine.restartConfirm.description')} confirmLabel={t('machine.restartConfirm.confirm')} confirmVariant="default" onConfirm={onRestart} />
            <ConfirmDialog open={confirming === 'archive'} onOpenChange={close} title={t('danger.archiveConfirm.title', { name })} description={t('danger.archiveConfirm.description')} confirmLabel={t('danger.archiveConfirm.confirm')} onConfirm={onArchive} />
            <DeleteWorkspaceDialog open={confirming === 'delete'} onOpenChange={close} name={name} onConfirm={onDelete} />
        </>
    )
}

function MenuItem({ icon: Icon, label, reason, destructive = false, onSelect }: { icon: LucideIcon; label: string; reason?: string; destructive?: boolean; onSelect: () => void }) {
    return (
        <TooltipDisabledReason reason={reason} side="left" className="flex w-full">
            <DropdownMenuItem variant={destructive ? 'destructive' : 'default'} disabled={!!reason} onSelect={onSelect} className="w-full">
                <Icon />
                {label}
            </DropdownMenuItem>
        </TooltipDisabledReason>
    )
}
