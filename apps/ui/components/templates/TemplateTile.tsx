'use client'

import { BorderBeam } from '@rerun/ui'
import { hashUnit, TemplateCardBoard, useBoardOnHover } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { AnimatePresence } from 'motion/react'
import { useTranslations } from 'next-intl'
import { TemplateCardThumbnail } from '@/components/templates/TemplateCardThumbnail'
import { TemplateConnectorLogos } from '@/components/templates/TemplateConnectorLogos'
import { TemplateCreatorAvatar } from '@/components/templates/TemplateCreatorAvatar'
import { TemplatePriceBadge } from '@/components/templates/TemplatePriceBadge'
import { templateCardImage } from '@/lib/templates/card-image'
import type { LibraryTemplate } from '@/lib/templates/library'
import { templateHeadline } from '@/lib/templates/library-view'
import { templateStatusLabel, templateStatusTone } from '@/lib/templates/status'
import { cn } from '@/lib/utils'

// The library's card: the board is the surface, the words sit under it on the dialog itself rather
// than in a second box, which is what lets a grid of them read as one calm sheet.
// Without `onSelect` the tile is a plain block: the foreman and the email capture show a template
// they do not let anyone pick.
export function TemplateTile({ template, selected = false, showStatus = false, onSelect, className }: { template: LibraryTemplate; selected?: boolean; showStatus?: boolean; onSelect?: () => void; className?: string }) {
    const t = useTranslations('templates.creator')
    const tStatus = useTranslations('templates.status')
    const { live, handlers } = useBoardOnHover(template.agents.length > 0)
    const { headline, subline } = templateHeadline(template)

    const tileClassName = cn('group flex min-w-0 flex-col rounded-xl text-left outline-none', className)

    const content = (
        <>
            <TemplateCardThumbnail
                image={templateCardImage(template)}
                className={cn(
                    'aspect-[1200/630] w-full rounded-xl transition-shadow duration-200',
                    selected && 'ring-2 ring-primary',
                    'group-focus-visible:ring-3 group-focus-visible:ring-ring/50',
                )}
            >
                {!selected && <BorderBeam pattern="ring" tone="neutral" angle={hashUnit(template.slug, 0) * 360} className="z-10 opacity-60 transition-opacity duration-200 group-hover:opacity-100" />}
                <AnimatePresence>{live && <TemplateCardBoard agents={template.agents} connectors={template.connectors} />}</AnimatePresence>
                {showStatus && template.status !== 'published' && (
                    <span className="absolute top-2 left-2 flex rounded-full bg-background/70 backdrop-blur">
                        <Badge size="xs" tone={templateStatusTone(template.status)} glow={false} className="font-medium">
                            {templateStatusLabel(template.status, tStatus)}
                        </Badge>
                    </span>
                )}
                <span className="absolute top-2 right-2 flex rounded-full bg-background/70 backdrop-blur empty:hidden">
                    <TemplatePriceBadge pricing={template.pricing} access={template.access} />
                </span>
            </TemplateCardThumbnail>

            {/* One line each, so every card is the same height and none leaves a hole: the
                agent's name says the job in a few words, the title spells it out under it. */}
            <span className="mt-3 truncate px-0.5 text-base leading-tight font-semibold tracking-tight text-foreground">{headline}</span>
            <span className="mt-1 truncate px-0.5 text-[13px] text-muted-foreground">{subline}</span>

            <span className="mt-2.5 flex items-center justify-between gap-3 px-0.5">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <TemplateCreatorAvatar creator={template.creator} size={16} />
                    <span className="truncate">{template.creator?.name ?? t('rerunTeam')}</span>
                </span>
                <TemplateConnectorLogos connectors={template.connectors} />
            </span>
        </>
    )

    if (!onSelect) {
        return (
            <div {...handlers} className={tileClassName}>
                {content}
            </div>
        )
    }

    return (
        <button type="button" onClick={onSelect} {...handlers} aria-pressed={selected} className={tileClassName}>
            {content}
        </button>
    )
}
