'use client'

import { PromptInputButton, PromptInputHeader, usePromptInputAttachments } from '@/components/ai-elements/prompt-input'
import { ChatAttachmentChip } from '@/components/chat/ChatAttachmentChip'
import type { UploadItem } from '@/hooks/useFileUploads'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { PaperclipIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

/**
 * Paperclip button that opens the file dialog of the surrounding <PromptInput>.
 * Must be rendered as a child of <PromptInput>. `disabledReason` is for a composer whose
 * conversation cannot take a file at all: the button stays visible and says why.
 */
export function AttachButton({ disabledReason }: { disabledReason?: string }) {
    const t = useTranslations('chat.attachments')
    const attachments = usePromptInputAttachments()
    const button = (
        <PromptInputButton tooltip={disabledReason ? undefined : t('attach')} disabled={!!disabledReason} onClick={() => attachments.openFileDialog()}>
            <PaperclipIcon className="size-4" />
        </PromptInputButton>
    )
    return <TooltipDisabledReason reason={disabledReason}>{button}</TooltipDisabledReason>
}

type ChatAttachmentsProps = {
    uploads: Map<string, UploadItem>
    onRetry: (id: string) => void
}

/**
 * Renders the files attached to the composer as chips, each showing its own upload.
 * Must be rendered as a child of <PromptInput> (uses usePromptInputAttachments()).
 */
export function ChatAttachments({ uploads, onRetry }: ChatAttachmentsProps) {
    const attachments = usePromptInputAttachments()

    if (attachments.files.length === 0) return null

    return (
        <PromptInputHeader>
            {attachments.files.map(file => (
                <ChatAttachmentChip key={file.id} file={file} upload={uploads.get(file.id)} onRemove={attachments.remove} onRetry={onRetry} />
            ))}
        </PromptInputHeader>
    )
}
