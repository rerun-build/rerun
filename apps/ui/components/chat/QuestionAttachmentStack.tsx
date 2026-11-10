'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { UploadItem } from '@/hooks/useFileUploads'
import { formatBytes } from '@/lib/files/format'
import { FileIcon, RefreshCwIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { FileUIPart } from 'ai'
import { useLocale, useTranslations } from 'next-intl'

export type StackedAttachment = { file: FileUIPart & { id: string }; upload: UploadItem | undefined }

type QuestionAttachmentStackProps = {
    items: StackedAttachment[]
    onRemove: (fileId: string) => void
    onRetry: (fileId: string) => void
}

const VISIBLE = 3
const TILTS = ['-rotate-6', 'rotate-4', '-rotate-3']

function statusLine(upload: UploadItem | undefined, locale: string, t: ReturnType<typeof useTranslations<'chat.attachments'>>): string {
    if (!upload) return t('waiting')
    if (upload.status === 'error') return upload.error ?? t('uploadFailed')
    if (upload.status === 'done') return formatBytes(upload.size, locale)
    if (upload.status === 'uploading') return t('uploadingProgress', { percent: Math.round(upload.progress * 100) })
    return upload.status === 'finishing' ? t('finishing') : t('waiting')
}

export function QuestionAttachmentStack({ items, onRemove, onRetry }: QuestionAttachmentStackProps) {
    if (items.length === 0) return null
    const visible = items.slice(-VISIBLE)
    const hidden = items.slice(0, -VISIBLE)

    return (
        <div className="-my-0.5 flex shrink-0 items-center px-1" onClick={e => e.stopPropagation()}>
            {visible.map((item, index) => (
                <Thumb key={item.file.id} item={item} tilt={TILTS[index % TILTS.length]} onRemove={onRemove} onRetry={onRetry} />
            ))}
            {hidden.length > 0 && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="ml-1.5 text-xs font-medium text-muted-foreground tabular-nums">+{hidden.length}</span>
                    </TooltipTrigger>
                    <TooltipContent>{hidden.map(item => item.file.filename).join(', ')}</TooltipContent>
                </Tooltip>
            )}
        </div>
    )
}

function Thumb({ item, tilt, onRemove, onRetry }: { item: StackedAttachment; tilt: string; onRemove: (id: string) => void; onRetry: (id: string) => void }) {
    const t = useTranslations('chat.attachments')
    const locale = useLocale()
    const { file, upload } = item
    const fileName = file.filename ?? t('fileFallback')
    const failed = upload?.status === 'error'
    const pending = !failed && upload?.status !== 'done'
    const isImage = file.mediaType?.startsWith('image/') && file.url

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className={cn('group/thumb relative -ml-2 size-8 shrink-0 transition-[rotate] duration-200 first:ml-0 hover:z-10 hover:rotate-0', tilt)}>
                    <div className={cn('relative size-full overflow-hidden rounded-md border border-foreground/15 bg-muted shadow-md shadow-black/30', failed && 'border-destructive/70')}>
                        {isImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.url} alt={file.filename ?? ''} className="size-full object-cover" />
                        ) : (
                            <span className="flex size-full items-center justify-center text-muted-foreground">
                                <FileIcon className="size-3.5" />
                            </span>
                        )}

                        {pending && (
                            <span className="absolute inset-0 bg-background/50">
                                <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-[scale]" style={{ scale: `${upload?.progress ?? 0} 1` }} />
                            </span>
                        )}

                        {failed && (
                            <button
                                type="button"
                                onClick={() => onRetry(file.id)}
                                aria-label={t('retryUploading', { name: fileName })}
                                className="absolute inset-0 flex items-center justify-center bg-background/70 text-destructive"
                            >
                                <RefreshCwIcon className="size-3" />
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={() => onRemove(file.id)}
                        aria-label={t('removeNamed', { name: fileName })}
                        className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover/thumb:opacity-100 focus-visible:opacity-100"
                    >
                        <XIcon className="size-2.5" />
                    </button>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                <span className="font-medium">{fileName}</span>
                <span className="ml-1.5 opacity-70">{statusLine(upload, locale, t)}</span>
            </TooltipContent>
        </Tooltip>
    )
}
