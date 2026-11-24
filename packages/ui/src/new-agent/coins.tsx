'use client'

import type { CSSProperties } from 'react'

import type { CatalogEntry, ConnectorCatalog } from './types'
import { cn } from '../cn'

import { AppLogo } from './marks'

// Empty coins hold the place of the logos until the catalogue lands, so a pile keeps its width.
// Once it has, an app the catalogue no longer carries simply draws no coin.
export function appCoins(slugs: string[], catalog: ConnectorCatalog | null): (CatalogEntry | null)[] {
    if (!catalog) return slugs.map(() => null)
    return slugs.flatMap(slug => catalog.get(slug) ?? [])
}

// A logo on a neutral coin, white in the light theme and dark in the dark one. `--cut` is the
// surface the coin sits on: a ring in that colour is what carves each coin out of the one under it,
// so whoever draws a stack sets it to their own background. Without an app it is the empty coin a
// stack shows while the catalogue is still on its way.
export function AppCoin({ app, size, titled, className, style }: { app: CatalogEntry | null; size: number; titled?: boolean; className?: string; style?: CSSProperties }) {
    return (
        <span className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white inset-ring inset-ring-black/[0.08] dark:bg-muted dark:inset-ring-white/[0.12]', className)} style={{ width: size, height: size, ...style }}>
            {app && <AppLogo app={app} titled={titled} className="size-[54%]" />}
        </span>
    )
}

export function CoinStack({ apps, size = 24, overlap = 6, className }: { apps: (CatalogEntry | null)[]; size?: number; overlap?: number; className?: string }) {
    return (
        <span className={cn('flex items-center', className)}>
            {apps.map((app, index) => (
                <AppCoin key={app?.slug ?? index} app={app} size={size} className="ring-2 ring-(--cut)" style={{ marginInlineStart: index === 0 ? 0 : -overlap, zIndex: apps.length - index }} />
            ))}
        </span>
    )
}
