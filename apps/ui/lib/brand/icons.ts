import type { Brand } from '@rerun/contracts'
import type { Metadata, MetadataRoute } from 'next'

// Outside `/brand/`, which next.config.ts sends to the back office.
export const RERUN_FAVICON = '/icons/favicon.ico'

// An organization uploads one square image, which every size is drawn from.
export function brandIcons({ iconUrl }: Brand): NonNullable<Metadata['icons']> {
    if (iconUrl) return { icon: iconUrl, apple: iconUrl }
    return {
        icon: [
            { url: RERUN_FAVICON, sizes: '48x48', type: 'image/x-icon' },
            { url: '/icon.png', sizes: '192x192', type: 'image/png' },
        ],
        apple: { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    }
}

export function brandManifestIcons({ iconUrl }: Brand): MetadataRoute.Manifest['icons'] {
    if (iconUrl) return [{ src: iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any' }]
    return [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
}
