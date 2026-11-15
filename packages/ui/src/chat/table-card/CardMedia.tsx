'use client'

import { useState } from 'react'

import { cn } from '../../cn'
import { ImageIcon } from '../../icons'

export type FileUrl = (path: string) => string | null

function resolveSrc(src: unknown, fileUrl?: FileUrl): string | null {
    if (typeof src !== 'string') return null
    const value = src.trim()
    if (!value) return null
    if (/^https?:\/\//i.test(value)) return value
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
    return fileUrl?.(value) ?? null
}

export function CardThumb({ src, fileUrl, className }: { src: unknown; fileUrl?: FileUrl; className?: string }) {
    const url = resolveSrc(src, fileUrl)
    const [brokenUrl, setBrokenUrl] = useState<string | null>(null)

    if (!url || brokenUrl === url) {
        return (
            <div className={cn('flex items-center justify-center bg-muted text-muted-foreground/40', className)}>
                <ImageIcon className="size-5" />
            </div>
        )
    }
    // eslint-disable-next-line @next/next/no-img-element -- any host the agent wrote, next/image would need each one allowlisted
    return <img src={url} alt="" loading="lazy" onError={() => setBrokenUrl(url)} className={cn('object-cover', className)} />
}

const AVATAR_TINTS = ['bg-brand/15 text-brand', 'bg-cyan-500/15 text-cyan-600', 'bg-green-500/15 text-green-600', 'bg-orange-500/15 text-orange-600', 'bg-pink-500/15 text-pink-600']

export function CardAvatar({ src, fileUrl, name, className }: { src?: unknown; fileUrl?: FileUrl; name: string; className?: string }) {
    const url = resolveSrc(src, fileUrl)
    const [brokenUrl, setBrokenUrl] = useState<string | null>(null)

    if (url && brokenUrl !== url) {
        // eslint-disable-next-line @next/next/no-img-element -- any host the agent wrote, next/image would need each one allowlisted
        return <img src={url} alt="" loading="lazy" onError={() => setBrokenUrl(url)} className={cn('shrink-0 rounded-full object-cover', className)} />
    }
    const initials = name
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase())
        .join('')
    let hash = 0
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return <div className={cn('flex shrink-0 items-center justify-center rounded-full text-[11px] font-medium', AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length], className)}>{initials}</div>
}
