'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { revertBrainPageAction } from '@/app/api/_actions/brain.actions'
import { BrainIcon } from '@/lib/icons'
import { useBrainStore } from '@/stores/brain.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { brainChangeHeadline, type BrainChange } from '@rerun/contracts'
import { Button, Icon } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export { brainChangeOf, type BrainChange, type BrainChangeStatus } from '@rerun/contracts'

// What the Rerun agent leaves in its conversation when it changed the company brain itself, the
// counterpart of an agent's proposal row: here the change has already landed.
export function BrainChangeBlock({ change }: { change: BrainChange }) {
    const openBrainPage = useWorkspaceSettingsStore(s => s.openBrainPage)
    const brainChanged = useBrainStore(s => s.brainChanged)
    const errorText = useErrorText()

    const [undo, setUndo] = useState<BrainChangeUndo>('idle')
    const undoRevisionId = change.status === 'saved' && change.mode === 'edit' ? change.undoRevisionId : null

    useEffect(() => {
        brainChanged()
    }, [brainChanged])

    const undoChange = async () => {
        if (!undoRevisionId) return
        setUndo('pending')
        const result = await revertBrainPageAction(change.slug, undoRevisionId, change.hash)
        if (!result.ok) {
            setUndo('idle')
            toast.error(errorText(result))
            return
        }
        setUndo('done')
        brainChanged()
    }

    return <BrainChangeCard change={change} undo={undo} onUndo={undoRevisionId ? () => void undoChange() : undefined} onOpen={() => openBrainPage(change.slug)} />
}

export type BrainChangeUndo = 'idle' | 'pending' | 'done'

export function BrainChangeCard({ change, undo, onUndo, onOpen }: { change: BrainChange; undo: BrainChangeUndo; onUndo?: () => void; onOpen: () => void }) {
    const t = useTranslations('chat.brainChange')
    const tHeadline = useTranslations('chat.brainChange.headline')
    return (
        <div className="rounded-xl bg-muted/30 px-1.5 py-1.5">
            <div className="flex items-center gap-3 text-sm">
                <Icon size="sm" icon={BrainIcon} />
                <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{undo === 'done' ? t('undone', { title: change.title }) : brainChangeHeadline(change, tHeadline)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{undo === 'done' ? t('undoneNote') : t(`notes.${change.status}`)}</span>
                </div>
                {onUndo && undo !== 'done' && (
                    <Button size="xs" variant="ghost" loading={undo === 'pending'} onClick={onUndo}>
                        {t('undo')}
                    </Button>
                )}
                {change.status !== 'deleted' && (
                    <Button size="xs" variant="ghost" onClick={onOpen}>
                        {t('open')}
                    </Button>
                )}
            </div>
        </div>
    )
}
