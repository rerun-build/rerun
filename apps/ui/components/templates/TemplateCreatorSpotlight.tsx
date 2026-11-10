'use client'

import { GitHubIcon, LinkedInIcon, XIcon } from '@rerun/ui/experts'
import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import { TemplateCardThumbnail } from '@/components/templates/TemplateCardThumbnail'
import { TemplateCreatorAvatar } from '@/components/templates/TemplateCreatorAvatar'
import { TemplateVerifiedBadge } from '@/components/templates/TemplateVerifiedBadge'
import { Button } from '@/components/ui/button'
import { ArrowRightIcon, CrownIcon, GlobeIcon, HandshakeIcon } from '@/lib/icons'
import { templateCardImage } from '@/lib/templates/card-image'
import type { LibraryCreator, LibraryTemplate } from '@/lib/templates/library'
import { creatorKindLabel, type LibraryCreatorSummary, templateHeadline } from '@/lib/templates/library-view'
import { landingUrl } from '@/lib/site'
import { cn } from '@/lib/utils'

// The landing's profile opens its contact form on this anchor, so "Work with" lands on the form
// rather than on a page where the same button has to be found again.
const WORK_WITH_HASH = '#work-with'

// The face as a photograph, their own words beside it, and the ways to reach them. The whole
// creator half is one link to their public profile; the template they are recognised for keeps
// its own column and its own action.
export function TemplateCreatorSpotlight({ creator, template, selected, onSelectTemplate }: { creator: LibraryCreatorSummary; template: LibraryTemplate; selected: boolean; onSelectTemplate: () => void }) {
    const t = useTranslations('templates.spotlight')
    const tKind = useTranslations('templates.creatorKind')
    const profileUrl = landingUrl(`/community/experts/${creator.slug}`)

    return (
        <article className="@container/spotlight overflow-hidden rounded-2xl border bg-card">
            <div className="grid @min-[56rem]/spotlight:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
                {/* A link stretched under the half rather than wrapped around it: the buttons inside
                    are links of their own, and an anchor cannot hold another. Everything above it lets
                    the click through except those buttons. */}
                <div className="group/creator relative grid transition-colors hover:bg-muted/20 @min-[40rem]/spotlight:grid-cols-[10rem_minmax(0,1fr)] @min-[56rem]/spotlight:grid-cols-[11rem_minmax(0,1fr)]">
                    <a href={profileUrl} target="_blank" rel="noreferrer" aria-label={t('viewProfile', { name: creator.name })} className="absolute inset-0 rounded-l-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
                    <div className="pointer-events-none relative hidden min-h-48 bg-muted @min-[40rem]/spotlight:block">
                        {creator.avatarUrl ? (
                            <img src={creator.avatarUrl} alt="" className="absolute inset-0 size-full object-cover object-[50%_30%]" />
                        ) : (
                            <span className="absolute inset-0 flex items-center justify-center">
                                <TemplateCreatorAvatar creator={creator} size={96} />
                            </span>
                        )}
                        <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-transparent from-55% to-card" />
                    </div>
                    <div className="pointer-events-none relative flex min-w-0 flex-col p-5 @min-[40rem]/spotlight:pl-3">
                        <CrownBadge />
                        <div className="mt-3 flex min-w-0 items-center gap-3">
                            {/* The photo column folds away when the detail panel narrows the page; the
                                face stays, as an avatar beside the name. */}
                            <TemplateCreatorAvatar creator={creator} size={44} className="@min-[40rem]/spotlight:hidden" />
                            <h3 className="font-heading flex min-w-0 items-center gap-2 text-[1.75rem] leading-tight font-semibold tracking-tight">
                                <span className="truncate">{creator.name}</span>
                                {creator.verified && <TemplateVerifiedBadge className="size-[1.1rem]" />}
                            </h3>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">{[creatorKindLabel(creator.kind, tKind), creator.location].filter(Boolean).join(' · ')}</p>
                        {creator.bio && (
                            <blockquote className="mt-3 border-l-2 border-primary/50 pl-3 text-sm leading-relaxed text-foreground/80">
                                <p className="line-clamp-2">{creator.bio}</p>
                            </blockquote>
                        )}
                        <div className="pointer-events-auto mt-auto flex flex-wrap items-center gap-2 self-start pt-4">
                            <Button asChild variant="outline" size="sm">
                                <a href={`${profileUrl}${WORK_WITH_HASH}`} target="_blank" rel="noreferrer">
                                    <HandshakeIcon className="size-3.5" />
                                    {t('workWith', { name: creator.name.split(' ')[0] })}
                                </a>
                            </Button>
                            <SocialLinks creator={creator} />
                        </div>
                    </div>
                </div>
                {/* Same padding as the creator half and both actions pinned to the bottom, so "Work
                    with" and "Open template" share one baseline whatever each column holds. */}
                <div className="hidden border-l p-5 @min-[56rem]/spotlight:flex">
                    <RecognizedCard template={template} selected={selected} onSelect={onSelectTemplate} className="w-full" />
                </div>
            </div>
            <div className="border-t p-4 @min-[56rem]/spotlight:hidden">
                <RecognizedRow template={template} selected={selected} onSelect={onSelectTemplate} />
            </div>
        </article>
    )
}

function CrownBadge() {
    const t = useTranslations('templates.spotlight')
    return (
        <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-full border border-primary/30 bg-background/70 px-2.5 text-xs font-medium text-foreground backdrop-blur">
            <CrownIcon className="size-3.5 text-primary" />
            {t('badge')}
        </span>
    )
}

// A brand keeps its own name; only the personal website gets a translated one.
const SOCIALS: { key: keyof LibraryCreator['links']; brand?: string; icon: ComponentType<{ className?: string }> }[] = [
    { key: 'linkedin', brand: 'LinkedIn', icon: LinkedInIcon },
    { key: 'x', brand: 'X', icon: XIcon },
    { key: 'github', brand: 'GitHub', icon: GitHubIcon },
    { key: 'website', icon: GlobeIcon },
]

function SocialLinks({ creator }: { creator: LibraryCreator }) {
    const t = useTranslations('templates.spotlight')
    return SOCIALS.filter(social => creator.links[social.key]).map(({ key, brand, icon: Glyph }) => (
        <Button key={key} asChild variant="outline" size="icon-sm">
            <a href={creator.links[key]!} target="_blank" rel="noreferrer" aria-label={t('socialLabel', { name: creator.name, network: brand ?? t('website') })}>
                <Glyph className="size-3.5" />
            </a>
        </Button>
    ))
}

function OpenTemplateButton({ onSelect, className }: { onSelect: () => void; className?: string }) {
    const t = useTranslations('templates.spotlight')
    return (
        <Button type="button" size="sm" onClick={onSelect} className={cn('group/open', className)}>
            {t('openTemplate')}
            <ArrowRightIcon className="size-3.5 transition-transform group-hover/open:translate-x-0.5" />
        </Button>
    )
}

function Thumb({ template, selected, onSelect, className }: { template: LibraryTemplate; selected: boolean; onSelect: () => void; className?: string }) {
    return (
        <button type="button" tabIndex={-1} aria-hidden onClick={onSelect} className={cn('block shrink-0', className)}>
            <TemplateCardThumbnail image={templateCardImage(template)} className={cn('aspect-[1200/630] w-full rounded-lg border transition-colors hover:border-foreground/20', selected && 'border-transparent ring-2 ring-primary')} />
        </button>
    )
}

function RecognizedText({ template }: { template: LibraryTemplate }) {
    const t = useTranslations('templates.spotlight')
    return (
        <>
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{t('recognizedFor')}</p>
            <p className="mt-1 line-clamp-2 text-sm leading-snug font-semibold tracking-tight">{templateHeadline(template).headline}</p>
        </>
    )
}

function RecognizedCard({ template, selected, onSelect, className }: { template: LibraryTemplate; selected: boolean; onSelect: () => void; className?: string }) {
    return (
        <div className={cn('flex flex-col', className)}>
            <Thumb template={template} selected={selected} onSelect={onSelect} className="w-full" />
            <div className="mt-2.5 mb-4">
                <RecognizedText template={template} />
            </div>
            <OpenTemplateButton onSelect={onSelect} className="mt-auto w-full" />
        </div>
    )
}

function RecognizedRow({ template, selected, onSelect }: { template: LibraryTemplate; selected: boolean; onSelect: () => void }) {
    return (
        <div className="flex items-center gap-4">
            <Thumb template={template} selected={selected} onSelect={onSelect} className="w-36" />
            <div className="flex min-w-0 flex-1 flex-col items-start">
                <RecognizedText template={template} />
                <OpenTemplateButton onSelect={onSelect} className="mt-2.5" />
            </div>
        </div>
    )
}
