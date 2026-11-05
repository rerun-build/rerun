'use client'

import { Button } from '@/components/ui/button'
import { PanelDeleteButton } from '@/components/ui/panel-editor'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { DownloadIcon, PencilIcon } from '@/lib/icons'
import { Badge } from '@rerun/ui/primitives'

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
    return (
        <>
            {truncated && (
                <Badge size="xs" tone="orange" glow={false}>
                    Truncated
                </Badge>
            )}
            {onEdit && (
                <TooltipDisabledReason reason={editDisabledReason}>
                    <Button size="icon-sm" variant="ghost" disabled={!!editDisabledReason} onClick={onEdit} title="Edit" aria-label="Edit">
                        <PencilIcon className="size-4" />
                    </Button>
                </TooltipDisabledReason>
            )}
            <Button size="icon-sm" variant="ghost" onClick={onDownload} title="Download" aria-label="Download">
                <DownloadIcon className="size-4" />
            </Button>
            {onPublish && <FilePublishControl name={name} publicUrl={publicUrl} onPublish={onPublish} onUnpublish={onUnpublish} onShareSettings={onShareSettings} openUrl={openUrl} />}
            <PanelDeleteButton
                label="Delete file"
                onClick={onDelete}
                confirmTitle={`Delete ${name}?`}
                confirmDescription="The file is deleted from the box. This cannot be undone."
            />
        </>
    )
}
