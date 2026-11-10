'use client'

import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'

import { ServiceIconRow } from '@/components/services/ServiceIconRow'
import { TemplateCardThumbnail } from '@/components/templates/TemplateCardThumbnail'
import { Button } from '@/components/ui/button'
import type { StarterPackCard as Card } from '@/lib/foreman/starter-pack'
import { CheckIcon, LockIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

// One card of the starter pack. It sells a use case, its title, and what lands is the coworker of
// the template behind it, named on the art. The board capture keeps the template card's own frame:
// it is fitted to 1200x630 with no bleed, so any other frame would crop it into a close-up.

const MAX_APPS = 3

type StarterPackCardProps = {
    card: Card
    picked: boolean
    // The three places are taken: this one can only be added once another is dropped.
    locked: boolean
    onToggle: () => void
    className?: string
}

export function StarterPackCard({ card, picked, locked, onToggle, className }: StarterPackCardProps) {
    const t = useTranslations('foreman.starterPack')
    return (
        <div
            role="button"
            tabIndex={0}
            data-slug={card.slug}
            aria-pressed={picked}
            onClick={onToggle}
            onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onToggle()
            }}
            className={cn(
                'group relative flex min-w-0 flex-col overflow-hidden rounded-xl border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                picked ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:border-foreground/20',
                className,
            )}
        >
            {picked && <BorderBeam animated pattern="arcs" tone="white" glow className="z-10" />}
            <TemplateCardThumbnail image={card.image} className="aspect-[1200/630] w-full border-b">
                {picked && (
                    <span className="absolute top-2.5 right-2.5 z-10 inline-flex size-6 items-center justify-center rounded-full bg-background/80 backdrop-blur">
                        <CheckIcon className="size-3.5 text-primary" />
                    </span>
                )}
            </TemplateCardThumbnail>

            <div className="flex flex-1 flex-col gap-2 p-4">
                <h3 className="text-xl leading-tight font-semibold tracking-tight text-balance text-foreground">{card.promise}</h3>
                {card.line && <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{card.line}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                    <ServiceIconRow slugs={card.connectors} max={MAX_APPS} />
                    <Button
                        size="sm"
                        variant={picked ? 'default' : 'outline'}
                        disabled={locked}
                        // The whole card toggles: without this, a click on the button would toggle it twice.
                        onClick={event => {
                            event.stopPropagation()
                            onToggle()
                        }}
                        className="ml-auto shrink-0"
                    >
                        {picked ? <CheckIcon data-icon="inline-start" className="size-3.5" /> : locked ? <LockIcon data-icon="inline-start" className="size-3.5" /> : null}
                        {picked ? t('picked') : locked ? t('trialFull') : t('pick')}
                    </Button>
                </div>
            </div>
        </div>
    )
}
