'use client'

import { Progress } from '@/components/ui/progress'
import type { UploadItem } from '@/hooks/useFileUploads'
import { formatBytes, formatEta } from '@/lib/files/format'
import { CheckIcon, FileIcon, RefreshCwIcon, XIcon } from '@/lib/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { FileUIPart } from 'ai'
import { useLocale, useTranslations } from 'next-intl'

type ChatAttachmentChipProps = {
    file: FileUIPart & { id: string }
    upload: UploadItem | undefined
    onRemove: (id: string) => void
    onRetry: (id: string) => void
}

function progressLine(upload: UploadItem, t: ReturnType<typeof useTranslations<'chat.attachments'>>): string {
    if (upload.status === 'queued') return t('waiting')
    if (upload.status === 'finishing') return t('finishing')
    const percent = Math.round(upload.progress * 100)
    return upload.etaMs != null ? t('progressWithEta', { percent, eta: formatEta(upload.etaMs) }) : t('progress', { percent })
}

export function ChatAttachmentChip({ file, upload, onRemove, onRetry }: ChatAttachmentChipProps) {
    const t = useTranslations('chat.attachments')
    const locale = useLocale()
    const isImage = file.mediaType?.startsWith('image/')
    const failed = upload?.status === 'error'
    const pending = upload != null && upload.status !== 'done' && upload.status !== 'error'

    return (
        <div className={`group relative flex items-center gap-2 rounded-lg border bg-background py-1.5 pl-1.5 pr-1 text-xs ${failed ? 'border-destructive/50' : 'border-border'}`}>
            {/* La pastille de succès se pose sur le coin de la vignette : dans une chip aussi basse,
                une colonne de plus pousse le nom du fichier et la ligne d'état se lit moins bien. */}
            <span className="relative shrink-0">
                {isImage && file.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.url} alt={file.filename ?? ''} className="size-9 rounded-sm object-cover" />
                ) : (
                    <span className="flex size-9 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                        <FileIcon className="size-4" />
                    </span>
                )}
                {upload?.status === 'done' && <IconBadge tone="green" icon={CheckIcon} className="absolute -right-1 -top-1 size-4 bg-background [&>svg]:size-2.5" />}
            </span>

            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="max-w-40 truncate text-foreground">{file.filename ?? t('fileFallback')}</span>
                {pending && (
                    <>
                        <Progress value={upload.status === 'finishing' ? null : upload.progress * 100} label={t('uploading', { name: file.filename ?? t('fileFallback') })} className="w-40" />
                        <span className="text-[10px] text-muted-foreground">{progressLine(upload, t)}</span>
                    </>
                )}
                {failed && <span className="max-w-40 truncate text-[10px] text-destructive">{upload.error}</span>}
                {upload?.status === 'done' && <span className="text-[10px] text-muted-foreground">{formatBytes(upload.size, locale)}</span>}
            </div>

            {/* Le padding droit de la chip est plus court que le gauche : le padding propre des boutons
                le complète, et les deux bords se lisent alors à la même distance du contenu. */}
            <span className="flex shrink-0 items-center gap-0.5">
                {failed && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button type="button" onClick={() => onRetry(file.id)} className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title={t('retryUpload')}>
                                <RefreshCwIcon className="size-3" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{upload.error}</TooltipContent>
                    </Tooltip>
                )}
                <button
                    type="button"
                    onClick={() => onRemove(file.id)}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={pending ? t('cancelUpload') : t('remove')}
                >
                    <XIcon className="size-3" />
                </button>
            </span>
        </div>
    )
}
