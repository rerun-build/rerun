'use client'

import { Button } from '@/components/ui/button'
import { PanelDeleteButton } from '@/components/ui/panel-editor'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { DownloadIcon, PencilIcon } from '@/lib/icons'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

import { FilePublishControl } from './FilePublishControl'

type FileDetailActionsProps = {
    name: string
    truncated: boolean
    editDisabledReason?: string
    onEdit?: () => void
    onDownload: () => void
    onDelete: () => void
    publicUrl?: string
    onPublish?: () => void
    onUnpublish?: () => void
    onShareSettings?: () => void
    openUrl?: string
}

export function FileDetailActions({ name, truncated, editDisabledReason, onEdit, onDownload, onDelete, publicUrl, onPublish, onUnpublish, onShareSettings, openUrl }: FileDetailActionsProps) {
    const t = useTranslations('files')
    return (
        <>
            {truncated && (
                <Badge size="xs" tone="orange" glow={false}>
                    {t('actions.truncated')}
                </Badge>
            )}
            {onEdit && (
                <TooltipDisabledReason reason={editDisabledReason}>
                    <Button size="icon-sm" variant="ghost" disabled={!!editDisabledReason} onClick={onEdit} title={t('actions.edit')} aria-label={t('actions.edit')}>
                        <PencilIcon className="size-4" />
                    </Button>
                </TooltipDisabledReason>
            )}
            <Button size="icon-sm" variant="ghost" onClick={onDownload} title={t('actions.download')} aria-label={t('actions.download')}>
                <DownloadIcon className="size-4" />
            </Button>
            {onPublish && <FilePublishControl name={name} publicUrl={publicUrl} onPublish={onPublish} onUnpublish={onUnpublish} onShareSettings={onShareSettings} openUrl={openUrl} />}
            <PanelDeleteButton
                label={t('actions.deleteFile')}
                onClick={onDelete}
                confirmTitle={t('delete.title', { name })}
                confirmDescription={t('delete.file')}
            />
        </>
    )
}
