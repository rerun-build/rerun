'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { PanelList } from '@/components/ui/panel-list'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog'
import { isBusy, isOpenable, type ConsoleWorkspace } from './types'

export type LifecycleAction = 'archive' | 'restore' | 'delete'

type WorkspaceLifecycleProps = {
    workspace: ConsoleWorkspace
    pending: LifecycleAction | null
    blockReason?: string
    onArchive: () => void
    onRestore: () => void
    onDelete: () => void
}

export function WorkspaceLifecycle({ workspace, pending, blockReason, onArchive, onRestore, onDelete }: WorkspaceLifecycleProps) {
    const t = useTranslations('organization.danger')
    const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null)
    const { name, status } = workspace
    const reason = blockReason ?? (isBusy(status) ? t('busy') : undefined)
    const disabled = !!reason || !!pending
    const archived = !isOpenable(status) && status !== 'archiving'

    return (
        <>
            <PanelList>
                {archived ? (
                    <LifecycleRow title={t('restore')} hint={t('restoreHint')} reason={reason}>
                        <Button variant="outline" disabled={disabled} loading={pending === 'restore'} onClick={onRestore}>
                            {t('restore')}
                        </Button>
                    </LifecycleRow>
                ) : (
                    <LifecycleRow title={t('archive')} hint={t('archiveHint')} reason={reason}>
                        <Button variant="outline" disabled={disabled} loading={pending === 'archive'} onClick={() => setConfirming('archive')}>
                            {t('archive')}
                        </Button>
                    </LifecycleRow>
                )}
                <LifecycleRow title={t('delete')} hint={t('deleteHint')} reason={reason}>
                    <Button variant="destructive" disabled={disabled} loading={pending === 'delete'} onClick={() => setConfirming('delete')}>
                        {t('delete')}
                    </Button>
                </LifecycleRow>
            </PanelList>
            <ConfirmDialog open={confirming === 'archive'} onOpenChange={open => !open && setConfirming(null)} title={t('archiveConfirm.title', { name })} description={t('archiveConfirm.description')} confirmLabel={t('archiveConfirm.confirm')} onConfirm={onArchive} />
            <DeleteWorkspaceDialog open={confirming === 'delete'} onOpenChange={open => !open && setConfirming(null)} name={name} onConfirm={onDelete} />
        </>
    )
}

function LifecycleRow({ title, hint, reason, children }: { title: string; hint: string; reason?: string; children: React.ReactNode }) {
    return (
        <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-3', PANEL_CARD)}>
            <div className="min-w-0 flex-1 basis-56 space-y-0.5">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <TooltipDisabledReason reason={reason}>{children}</TooltipDisabledReason>
        </div>
    )
}
