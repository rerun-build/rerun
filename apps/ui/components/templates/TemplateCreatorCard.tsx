'use client'

import { useTranslations } from 'next-intl'
import { TemplateCreatorAvatar } from '@/components/templates/TemplateCreatorAvatar'
import { TemplateVerifiedBadge } from '@/components/templates/TemplateVerifiedBadge'
import { creatorKindLabel, type LibraryCreatorSummary } from '@/lib/templates/library-view'
import { landingUrl } from '@/lib/site'
import { cn } from '@/lib/utils'

const CARD_CLASS = 'group flex min-w-0 items-center gap-2 rounded-xl border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30'

// A creator with templates opens their shelf inside the library, so browsing their work never
// costs leaving the app. One without any yet has nothing to open but their public page.
export function TemplateCreatorCard({ creator, onOpen, className }: { creator: LibraryCreatorSummary; onOpen: () => void; className?: string }) {
    const t = useTranslations('templates.creator')
    const tKind = useTranslations('templates.creatorKind')
    const count = creator.templates.length
    const content = (
        <>
            <TemplateCreatorAvatar creator={creator} size={32} />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                    <span className="truncate text-[13px] font-medium">{creator.name}</span>
                    {creator.verified && <TemplateVerifiedBadge className="size-3" />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{count > 0 ? t('templateCount', { count }) : [creatorKindLabel(creator.kind, tKind), creator.location].filter(Boolean).join(' · ')}</span>
            </span>
        </>
    )

    if (count === 0) {
        return (
            <a href={landingUrl(`/community/experts/${creator.slug}`)} target="_blank" rel="noreferrer" className={cn(CARD_CLASS, className)}>
                {content}
            </a>
        )
    }
    return (
        <button type="button" onClick={onOpen} className={cn(CARD_CLASS, className)}>
            {content}
        </button>
    )
}
