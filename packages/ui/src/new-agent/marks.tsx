'use client'

import { brandIconFilter } from '../brand-icon'

import type { CatalogEntry } from './types'
import { cn } from '../cn'

export function AppLogo({ app, titled = true, className }: { app: CatalogEntry; titled?: boolean; className?: string }) {
    if (!app.icon || !/^https?:\/\//i.test(app.icon)) return <span aria-label={app.name} className={cn('size-4 shrink-0', className)} />
    return <img src={app.icon} alt={app.name} title={titled ? app.name : undefined} className={cn('size-4 shrink-0 object-contain', className)} style={{ filter: brandIconFilter(app.icon) }} />
}

export function AgentTile({ lit, className }: { lit: boolean; className?: string }) {
    return (
        <svg viewBox="0 0 40 40" className={cn('size-8 shrink-0', className)} aria-hidden>
            <polygon points="20,8 35,15.5 20,23 5,15.5" className={lit ? 'fill-[#262626] dark:fill-[#f5f5f5]' : 'fill-[#e8e8e8] dark:fill-[#383838]'} />
            <polygon points="5,15.5 20,23 20,30 5,22.5" className={lit ? 'fill-[#5c5c5c] dark:fill-[#a3a3a3]' : 'fill-[#d6d6d6] dark:fill-[#2a2a2a]'} />
            <polygon points="20,23 35,15.5 35,22.5 20,30" className={lit ? 'fill-[#424242] dark:fill-[#737373]' : 'fill-[#c9c9c9] dark:fill-[#212121]'} />
            {!lit && <polygon points="20,8 35,15.5 20,23 5,15.5" fill="none" strokeWidth="0.8" className="stroke-black/10 dark:stroke-white/12" />}
        </svg>
    )
}

export function Caret({ className }: { className?: string }) {
    return <span aria-hidden className={cn('inline-block h-[1.15em] w-px translate-y-[0.2em] bg-foreground', className)} />
}
