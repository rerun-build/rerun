'use client'

import type { CSSProperties } from 'react'

import type { CatalogEntry, ConnectorCatalog } from './types'
import { cn } from '../cn'

import { AppLogo } from './marks'

export function appCoins(slugs: string[], catalog: ConnectorCatalog | null): (CatalogEntry | null)[] {
    if (!catalog) return slugs.map(() => null)
    return slugs.flatMap(slug => catalog.get(slug) ?? [])
}

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
                <AppCoin key={app?.slug ?? index} app={app} size={size} className="ring-2 ring-(--cut)" style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: apps.length - index }} />
            ))}
        </span>
    )
}
