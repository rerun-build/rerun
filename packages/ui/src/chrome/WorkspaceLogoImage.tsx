'use client'

import { useState } from 'react'
import { cn } from '../cn'

export type WorkspaceLogoImageProps = {
    src: string
    fallbackSrc?: string
    className?: string
}

export function WorkspaceLogoImage({ src, fallbackSrc, className }: WorkspaceLogoImageProps) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    const failed = failedSrc === src

    const catchFailedBeforeHydration = (node: HTMLImageElement | null) => {
        if (node?.complete && node.naturalWidth === 0 && node.getAttribute('src') === src) setFailedSrc(src)
    }

    return <img ref={catchFailedBeforeHydration} src={failed && fallbackSrc ? fallbackSrc : src} alt="" onError={() => setFailedSrc(src)} className={cn(className, failed && !fallbackSrc && 'bg-muted')} />
}
