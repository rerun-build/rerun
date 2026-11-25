import { isWhiteLabel, type Brand } from '@rerun/contracts'
import type { Metadata, MetadataRoute } from 'next'

// Outside `/brand/`, which next.config.ts sends to the back office.
export const RERUN_FAVICON = '/icons/favicon.ico'

// Drawn by the app for an organization that uploaded no image yet (app/icons/initial.png).
const INITIAL_ICON = '/icons/initial.png'

// The one square image of an organization, which every size is drawn from. Null for Rerun, which has
// a file per size.
export function organizationIconUrl(brand: Brand): string | null {
    return isWhiteLabel(brand) ? (brand.iconUrl ?? INITIAL_ICON) : null
}

export function brandIcons(brand: Brand): NonNullable<Metadata['icons']> {
    const iconUrl = organizationIconUrl(brand)
    if (iconUrl) return { icon: iconUrl, apple: iconUrl }
    return {
        icon: [
            { url: RERUN_FAVICON, sizes: '48x48', type: 'image/x-icon' },
            { url: '/icon.png', sizes: '192x192', type: 'image/png' },
        ],
        apple: { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    }
}

export function brandManifestIcons(brand: Brand): MetadataRoute.Manifest['icons'] {
    const iconUrl = organizationIconUrl(brand)
    if (iconUrl) return [{ src: iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any' }]
    return [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
}
