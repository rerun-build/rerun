'use client'

import { useState } from 'react'
import { cn } from '../cn'

export type WorkspaceLogoImageProps = {
    src: string
    fallbackSrc?: string
    className?: string
}

// L'icône peut venir du site de l'entreprise, donc d'un service tiers qui peut cesser de la servir,
// ou d'un fichier absent du stockage de l'install : une image cassée se voit sur toutes les pages,
// d'où le repli au premier échec.
export function WorkspaceLogoImage({ src, fallbackSrc, className }: WorkspaceLogoImageProps) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    const failed = failedSrc === src

    // Rendue côté serveur, une image déjà cassée a fini d'échouer avant que React n'attache ses
    // écouteurs : son `error` n'arrivera jamais, et seul l'état du noeud le dit.
    const catchFailedBeforeHydration = (node: HTMLImageElement | null) => {
        if (node?.complete && node.naturalWidth === 0 && node.getAttribute('src') === src) setFailedSrc(src)
    }

    return <img ref={catchFailedBeforeHydration} src={failed && fallbackSrc ? fallbackSrc : src} alt="" onError={() => setFailedSrc(src)} className={cn(className, failed && !fallbackSrc && 'bg-muted')} />
}
