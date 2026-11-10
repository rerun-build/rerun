'use client'

import { Icon } from '@/components/ui/icon'
import { filePreviewKind, fileTypeIcon } from '@/lib/files/preview'
import { rawUrlResolver, type RawUrlFor } from '@/lib/files/raw-url'
import { FileIcon, FileTextIcon, Play } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

type AttachmentTileProps = {
    /** Absent on read-only transcripts rendered outside a Box: the tile stays inert. */
    agentId?: string
    path: string
    /** Shown instead of the file name, e.g. once the composer's uniqueness prefix is stripped. */
    label?: string
    /** Where the bytes come from when they are not a Box's: the foreman's bucket, the design lab. */
    rawUrlFor?: RawUrlFor
    onOpen: () => void
    /** A lone image keeps its own proportions instead of being cropped into the square grid. */
    standalone?: boolean
    className?: string
}

/** One file rendered as a clickable square: its own thumbnail for an image, its first frame for a video, a typed glyph otherwise. */
export function AttachmentTile({ agentId, path, label, rawUrlFor, onOpen, standalone = false, className }: AttachmentTileProps) {
    const t = useTranslations('chat.attachments')
    const name = label ?? path.split('/').pop() ?? path
    const rawUrl = rawUrlResolver(agentId, rawUrlFor)
    const isImage = rawUrl !== null && filePreviewKind(name) === 'image'
    const isVideo = rawUrl !== null && filePreviewKind(name) === 'video'
    const frame = 'relative overflow-hidden rounded-2xl bg-muted transition-opacity disabled:cursor-default enabled:hover:opacity-90'
    const fitsContent = standalone && isImage

    return (
        <button type="button" onClick={onOpen} disabled={!rawUrl} title={name} aria-label={t('open', { name })} className={cn(frame, !fitsContent && 'size-28', className)}>
            {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary proxied file bytes, no fixed dimensions or configured loader
                <img
                    src={rawUrl(path)}
                    alt={name}
                    loading="lazy"
                    decoding="async"
                    className={fitsContent ? 'max-h-64 max-w-full object-contain' : 'size-full object-cover'}
                />
            ) : isVideo ? (
                <>
                    <video src={`${rawUrl(path)}#t=0.1`} preload="metadata" muted playsInline className="pointer-events-none size-full object-cover" />
                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                        <span className="grid size-8 place-items-center rounded-full bg-white/90 text-black shadow-sm">
                            <Play className="size-3.5 translate-x-px [&_*]:fill-current" />
                        </span>
                    </span>
                </>
            ) : (
                <span className="flex size-full flex-col items-center justify-center gap-1 p-1.5">
                    <Icon icon={fileTypeIcon(name) ?? (filePreviewKind(name) === 'text' ? FileTextIcon : FileIcon)} size="md" />
                    <span className="line-clamp-2 w-full break-words text-center text-[10px] leading-tight text-muted-foreground">{name}</span>
                </span>
            )}
        </button>
    )
}
