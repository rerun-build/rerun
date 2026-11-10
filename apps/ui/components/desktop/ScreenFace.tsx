'use client'

import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { DesktopScreenLoader } from '@/components/desktop/DesktopScreenLoader'
import { MonitorIcon } from '@/lib/icons'

export type ScreenStatus = 'loading' | 'live' | 'error' | 'disconnected'

const UNAVAILABLE_KEYS = { error: 'unavailable', disconnected: 'wentAway' } as const

// What fills a 16:9 box, whatever its size: the block in the thread, the floating thumbnail. The live
// screen is the caller's.
export function ScreenFace({ status, children }: { status: ScreenStatus; children: ReactNode }) {
    const t = useTranslations('desktop.screen')
    if (status === 'loading') return <DesktopScreenLoader compact className="bg-muted/40" />
    if (status === 'live') return children
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 bg-muted/40 px-4 text-center text-muted-foreground">
            <MonitorIcon className="size-5" />
            <p className="text-xs">{t(UNAVAILABLE_KEYS[status])}</p>
        </div>
    )
}
