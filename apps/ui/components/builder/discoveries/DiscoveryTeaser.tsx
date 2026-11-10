'use client'

import { TextShimmer } from '@rerun/ui'
import { useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'
import type { DiscoverySource } from '@/lib/company/explore/findings'
import { DISCOVERY_CARD_CLASS, useDiscoverySourceLabel } from './DiscoveryCard'

// Each teaser is drawn in the shape of the card it turns into, so the swap reads as the same card
// being filled in rather than one card replaced by another.
type TeaserShape = 'identity' | 'person' | 'chips' | 'stat' | 'line'

const TEASER_SHAPE: Record<DiscoverySource, TeaserShape> = {
    profile: 'identity',
    stack: 'chips',
    dns: 'line',
    registry: 'line',
    site: 'chips',
    search: 'line',
    linkedinPerson: 'person',
    linkedinCompany: 'stat',
    googleBusiness: 'stat',
    catalog: 'chips',
    synthesis: 'chips',
}

function TeaserBody({ shape }: { shape: TeaserShape }) {
    switch (shape) {
        case 'identity':
            return (
                <div className="flex items-center gap-3">
                    <Skeleton className="size-10 shrink-0 rounded-lg" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3.5 w-1/2" />
                        <Skeleton className="h-3 w-4/5" />
                    </div>
                </div>
            )
        case 'person':
            return (
                <div className="flex items-center gap-3">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3.5 w-2/5" />
                        <Skeleton className="h-3 w-3/4" />
                    </div>
                </div>
            )
        case 'chips':
            return (
                <div className="flex flex-wrap gap-1">
                    {['w-16', 'w-20', 'w-14'].map(width => (
                        <Skeleton key={width} className={`h-5 ${width} rounded-md`} />
                    ))}
                </div>
            )
        case 'stat':
            return (
                <div className="flex items-center gap-3">
                    <Skeleton className="h-7 w-12" />
                    <Skeleton className="h-3 w-24" />
                </div>
            )
        case 'line':
            return <Skeleton className="h-3 w-3/4" />
    }
}

export function DiscoveryTeaser({ source, subject }: { source: DiscoverySource; subject: { name: string; domain: string } }) {
    const t = useTranslations('builder.discoveries.teasers')
    const sourceLabel = useDiscoverySourceLabel()
    return (
        <div className={DISCOVERY_CARD_CLASS}>
            <div className="mb-2 flex items-center gap-2">
                <Skeleton className="size-5 rounded-md" />
                <TextShimmer className="truncate text-[11px] font-medium">{t(source, subject)}</TextShimmer>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{sourceLabel(source)}</span>
            </div>
            <TeaserBody shape={TEASER_SHAPE[source]} />
        </div>
    )
}
