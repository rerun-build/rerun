'use client'

import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'
import type { ReactNode, Ref } from 'react'

import { TakeoverAsk, type TakeoverRequestState } from '@/components/chat/TakeoverAsk'
import { TakeControlOverlay } from '@/components/desktop/TakeControlOverlay'
import { GlobeIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ScreenCardProps = {
    live: boolean
    site: string | null
    screen: ReactNode
    takeover?: TakeoverRequestState
    onTakeControl: () => void
    ref?: Ref<HTMLDivElement>
}

// The coworker's screen as a block of its thread, where the run uses it. A takeover the run asks for
// joins the same block, under a rule: the screen it is about, then what to do.
export function ScreenCard({ live, site, screen, takeover, onTakeControl, ref }: ScreenCardProps) {
    const t = useTranslations('desktop.screenCard')
    return (
        <div ref={ref} className={cn('relative w-full max-w-[95%] overflow-hidden rounded-xl ring-1 ring-border', takeover ? 'bg-muted/30' : 'bg-background')}>
            <div className={cn('group relative flex aspect-video overflow-hidden', takeover && 'm-1.5 rounded-lg bg-background')}>
                {screen}
                {live && site && (
                    <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                        <GlobeIcon className="size-3" />
                        {site}
                    </span>
                )}
                {live && !takeover?.locked && <TakeControlOverlay label={takeover ? t('openBrowser') : t('takeControl')} onClick={takeover ? takeover.onOpen : onTakeControl} />}
            </div>
            {takeover && (
                <div className="border-t border-border">
                    <TakeoverAsk takeover={takeover} />
                </div>
            )}
            {/* Last and above, or the opaque screen paints over the ring. */}
            {takeover && <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={7} className="z-10" />}
        </div>
    )
}
