'use client'

import { useEffect, useEffectEvent } from 'react'

import { getPublishedAction } from '@/app/api/_actions/publish.actions'
import type { PublishedFile } from '@/lib/services/types'

const POLL_MS = 3_000
const CAPTURE_WINDOW_MS = 90_000

export function useAwaitedThumbnail(file: PublishedFile | null | undefined, onFile: (file: PublishedFile) => void) {
    const slug = file?.slug
    const publishedAt = file && !file.thumbnailUrl ? Date.parse(file.updatedAt) : null
    const deliver = useEffectEvent(onFile)

    useEffect(() => {
        if (!slug || publishedAt === null) return
        const deadline = publishedAt + CAPTURE_WINDOW_MS
        if (Date.now() >= deadline) return

        let cancelled = false
        const timer = setInterval(() => {
            if (Date.now() >= deadline) return clearInterval(timer)
            void getPublishedAction(slug).then(next => {
                if (cancelled || !next?.thumbnailUrl) return
                clearInterval(timer)
                deliver(next)
            })
        }, POLL_MS)
        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [slug, publishedAt])
}
