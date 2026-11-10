'use client'

import { ChatVideoTile, MEDIA_CELL_ASPECT, type MediaTileShape } from '@/components/chat/ChatVideoTile'
import { filePreviewKind } from '@/lib/files/preview'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export type MediaAlbumItem = { path: string; name: string; src: string }

const MAX_ALBUM_TILES = 4

/** Whether a list of files reads as an album: images and videos only. */
export function isMediaAlbum(names: readonly string[]): boolean {
    return names.length > 0 && names.every(name => ['image', 'video'].includes(filePreviewKind(name)))
}

function MediaTile({ item, shape, onOpen }: { item: MediaAlbumItem; shape: MediaTileShape; onOpen: () => void }) {
    const t = useTranslations('chat.attachments')
    if (filePreviewKind(item.name) === 'video') return <ChatVideoTile src={item.src} name={item.name} shape={shape} onOpen={onOpen} />
    const natural = shape === 'natural'
    return (
        <button
            type="button"
            onClick={onOpen}
            title={item.name}
            aria-label={t('open', { name: item.name })}
            className={cn('overflow-hidden rounded-2xl bg-muted transition-opacity hover:opacity-90', natural ? 'max-h-72 max-w-full' : cn('w-full', MEDIA_CELL_ASPECT[shape]))}
        >
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary proxied file bytes, no fixed dimensions or configured loader */}
            <img src={item.src} alt={item.name} loading="lazy" decoding="async" className={natural ? 'max-h-72 max-w-full object-contain' : 'size-full object-cover'} />
        </button>
    )
}

type MediaAlbumProps = {
    items: readonly MediaAlbumItem[]
    /** An agent's files carry their names, so candidates can be told apart; a user's own upload does not. */
    captions: boolean
    align?: 'start' | 'end'
    onOpen: (index: number) => void
}

/**
 * Images and videos sent together, grouped the way a messenger does: a lone one keeps its own
 * proportions, several share a two-column album whose last cell counts what did not fit.
 */
export function MediaAlbum({ items, captions, align = 'start', onOpen }: MediaAlbumProps) {
    const t = useTranslations('chat.attachments')
    if (items.length === 1) {
        const [only] = items
        return (
            <figure className={cn('flex min-w-0 flex-col gap-1', align === 'end' ? 'items-end' : 'items-start')}>
                <MediaTile item={only} shape="natural" onOpen={() => onOpen(0)} />
                {captions && <figcaption className="max-w-full truncate px-1 text-[11px] text-muted-foreground">{only.name}</figcaption>}
            </figure>
        )
    }

    const shown = items.slice(0, MAX_ALBUM_TILES)
    const hidden = items.length - shown.length

    return (
        <div className={cn('grid w-full max-w-md grid-cols-2 gap-1.5', align === 'end' && 'ml-auto')}>
            {shown.map((item, index) => {
                const wide = shown.length === 3 && index === 0
                return (
                    <figure key={`${index}:${item.path}`} className={cn('relative flex min-w-0 flex-col gap-1', wide && 'col-span-2')}>
                        <MediaTile item={item} shape={wide ? 'wide' : 'cell'} onOpen={() => onOpen(index)} />
                        {hidden > 0 && index === shown.length - 1 && (
                            <button
                                type="button"
                                onClick={() => onOpen(index)}
                                aria-label={t('openMore', { count: hidden })}
                                className={cn('absolute inset-x-0 top-0 grid place-items-center rounded-2xl bg-black/55 text-2xl font-medium text-white', MEDIA_CELL_ASPECT.cell)}
                            >
                                +{hidden}
                            </button>
                        )}
                        {captions && <figcaption className="truncate px-1 text-[11px] text-muted-foreground">{item.name}</figcaption>}
                    </figure>
                )
            })}
        </div>
    )
}
