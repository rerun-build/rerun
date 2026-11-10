'use client'

import { templateCategoryLabel } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { TemplateCardBoard, useBoardOnHover } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { TemplateCardPrice } from '@/components/templates/TemplateCardPrice'
import { TemplateCardThumbnail } from '@/components/templates/TemplateCardThumbnail'
import { templateStatusLabel, templateStatusTone } from '@/lib/templates/status'
import { templateCardImage } from '@/lib/templates/card-image'
import type { LibraryTemplate } from '@/lib/templates/library'
import { cn } from '@/lib/utils'
import { ClockIcon } from '@/lib/icons'
import { AnimatePresence } from 'motion/react'
import { useTranslations } from 'next-intl'

// The wide sibling of TemplateCard, for the Featured row: cover on the left, editorial on the
// right. Same props, so a click feeds the detail panel exactly like a grid card does, and the same
// three lines under the title, with the tagline in between as the one thing the extra room buys.
export function TemplateFeaturedCard({ template, selected, showStatus, onSelect }: { template: LibraryTemplate; selected: boolean; showStatus: boolean; onSelect: () => void }) {
    const t = useTranslations('templates.detail')
    const tCategory = useTranslations('templates.categories')
    const tStatus = useTranslations('templates.status')
    const image = templateCardImage(template)
    const category = templateCategoryLabel(template.category, tCategory)
    const { live, handlers } = useBoardOnHover(template.agents.length > 0)

    return (
        <button
            type="button"
            onClick={onSelect}
            {...handlers}
            className={cn(
                'group relative flex w-full flex-col overflow-hidden rounded-xl border text-left transition-[background-color,border-color] sm:h-64 sm:flex-row',
                selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:border-foreground/20 hover:bg-muted/30',
            )}
        >
            {/* z-10, unlike the OptionCard this mirrors: the cover image would otherwise paint over the beam. */}
            {selected && <BorderBeam animated pattern="arcs" tone="white" glow className="z-10" />}
            {/* The same light the grid cards answer a hover with, rising from the bottom edge under
                the cursor, since nothing here scales or moves either. */}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 bg-[radial-gradient(120%_100%_at_50%_100%,rgba(0,0,0,0.06),transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 dark:bg-[radial-gradient(120%_100%_at_50%_100%,rgba(255,255,255,0.1),transparent_70%)]"
            />

            {/* The only thumbnail slot in the product that is not 1200x630: on desktop it is a wide
                panel beside the text, kept close to the capture's own ratio so a letterboxed board
                barely shows its bars. A cover has bleed and can be cropped to fill, a board capture is
                fitted flush to its own frame and would lose its outer connectors, so it is letterboxed.
                Its inner edge dissolves into the body rather than meeting it on a rule, which is what
                turns the two halves into one surface. */}
            <TemplateCardThumbnail
                image={image}
                fit={image?.kind === 'board' ? 'contain' : 'cover'}
                fade="row"
                className="aspect-[1200/630] shrink-0 sm:aspect-auto sm:h-full sm:w-[52%]"
            >
                {/* Under the cursor the capture gives way to the board itself: the same frame, at the
                    same scale, except this one draws itself and then lives. */}
                <AnimatePresence>{live && <TemplateCardBoard agents={template.agents} connectors={template.connectors} />}</AnimatePresence>
                {showStatus && template.status !== 'published' && (
                    // Le fond soft du Badge seul ne tient pas au-dessus d'une cover : le wrapper opacifie.
                    <span className="absolute left-3 top-3 flex rounded-full bg-background/70 backdrop-blur">
                        <Badge size="xs" tone={templateStatusTone(template.status)} glow={false} className="font-medium">
                            {templateStatusLabel(template.status, tStatus)}
                        </Badge>
                    </span>
                )}
            </TemplateCardThumbnail>

            <span className="relative flex min-w-0 flex-1 flex-col gap-1.5 p-5">
                <span className="line-clamp-2 text-lg leading-snug font-medium">{template.title}</span>
                <span className="line-clamp-3 text-sm text-muted-foreground">{template.tagline}</span>

                {/* Pinned to the bottom rather than centred with the rest: the card has a fixed
                    height, and a floating block leaves a void above and below it. Same line as the
                    grid card, the category the only part allowed to give ground so a narrow card
                    never turns "5 min" into "5 m". */}
                <span className="mt-auto flex min-h-6 items-center justify-between gap-2 pt-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">{category}</span>
                        <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-current opacity-50" />
                        <span className="flex shrink-0 items-center gap-1.5">
                            <ClockIcon className="size-3" />
                            {t('minutes', { minutes: template.setupMinutes })}
                        </span>
                    </span>
                    <TemplateCardPrice pricing={template.pricing} access={template.access} />
                </span>
            </span>
        </button>
    )
}
