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
            {selected && <BorderBeam animated pattern="arcs" tone="white" glow className="z-10" />}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 bg-[radial-gradient(120%_100%_at_50%_100%,rgba(0,0,0,0.06),transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 dark:bg-[radial-gradient(120%_100%_at_50%_100%,rgba(255,255,255,0.1),transparent_70%)]"
            />

            <TemplateCardThumbnail
                image={image}
                fit={image?.kind === 'board' ? 'contain' : 'cover'}
                fade="row"
                className="aspect-[1200/630] shrink-0 sm:aspect-auto sm:h-full sm:w-[52%]"
            >
                <AnimatePresence>{live && <TemplateCardBoard agents={template.agents} connectors={template.connectors} />}</AnimatePresence>
                {showStatus && template.status !== 'published' && (
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
