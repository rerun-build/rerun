'use client'

import { useState } from 'react'
import { ImageIcon } from '@/lib/icons'
import { RAW_URL, ViewerPage, ViewerTopBar } from './ViewerChrome'

export function ImageViewer({ slug, name }: { slug: string; name: string }) {
    const [size, setSize] = useState<string | undefined>()
    return (
        <ViewerPage slug={slug} bar={<ViewerTopBar icon={ImageIcon} name={name} meta={size} />} className="flex items-center justify-center bg-muted/60 p-6 max-md:p-3">
            <a href={RAW_URL} target="_blank" rel="noopener" className="flex max-h-full max-w-[720px] cursor-zoom-in">
                {/* eslint-disable-next-line @next/next/no-img-element -- a published file, served through its own signed URL */}
                <img
                    src={RAW_URL}
                    alt={name}
                    className="max-h-full max-w-full rounded-md object-contain shadow-lg"
                    onLoad={event => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
                />
            </a>
        </ViewerPage>
    )
}
