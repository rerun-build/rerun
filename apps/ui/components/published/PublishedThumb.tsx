'use client'

import { useState } from 'react'

import type { PublishedFile } from '@/lib/services/types'
import { FileIcon, FileTextIcon, FilmIcon, GlobeIcon, ImageIcon, TableIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

function KindIcon({ file, className }: { file: Pick<PublishedFile, 'kind' | 'contentType' | 'path'>; className?: string }) {
    const type = file.contentType
    if (file.kind === 'site' || type.startsWith('text/html')) return <GlobeIcon className={className} />
    if (type.startsWith('image/')) return <ImageIcon className={className} />
    if (type.startsWith('video/')) return <FilmIcon className={className} />
    if (type.includes('csv') || file.path.toLowerCase().endsWith('.csv')) return <TableIcon className={className} />
    if (type.startsWith('text/') || type === 'application/pdf') return <FileTextIcon className={className} />
    return <FileIcon className={className} />
}

// The capture taken after each publish, 16:10 and pinned to the top of the page. Until it exists,
// or when it fails to load, a tile with the kind of file stands in its place.
export function PublishedThumb({ file, className }: { file: Pick<PublishedFile, 'kind' | 'contentType' | 'path' | 'thumbnailUrl'>; className?: string }) {
    const [broken, setBroken] = useState<string | null>(null)
    const src = file.thumbnailUrl && broken !== file.thumbnailUrl ? file.thumbnailUrl : null
    return (
        <div className={cn('relative aspect-[16/10] overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10', className)}>
            {src ? (
                <img src={src} alt="" className="absolute inset-0 size-full object-cover object-top" onError={() => setBroken(src)} />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <KindIcon file={file} className="size-5" />
                </div>
            )}
        </div>
    )
}
