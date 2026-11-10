'use client'

import { useTranslations } from 'next-intl'

import { TemplateTile } from '@/components/templates/TemplateTile'
import { TemplateTileSkeleton } from '@/components/templates/TemplateTileSkeleton'
import { Icon } from '@/components/ui/icon'
import { TooltipLabeled } from '@/components/ui/tooltip'
import type { TemplateBySlug } from '@/hooks/useTemplateBySlug'
import { CircleCheckIcon, MinusIcon, Wand2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

import type { TemplateChoice } from './template-choice'

// The one template somebody arrived on, shown as the card it is in the library rather than as a
// row: this is the first thing a new account sees of the product, and the board capture says what
// it installs, apps included, in a way no line of prose does. The card carries no action: what it
// asks for is decided right under it, in `ForemanTemplateActions`, and all that is left here once
// it is decided is the verdict in the corner.

type ForemanTemplateCardProps = {
    loaded: TemplateBySlug
    answered: TemplateChoice | null
}

function verdictOf(answer: TemplateChoice) {
    if (!answer.answered) return { icon: MinusIcon, labelKey: 'skipped', className: 'text-muted-foreground' } as const
    return 'custom' in answer ? ({ icon: Wand2, labelKey: 'buildingElse', className: 'text-muted-foreground' } as const) : ({ icon: CircleCheckIcon, labelKey: 'installing', className: 'text-emerald-500' } as const)
}

export function ForemanTemplateCard({ loaded, answered }: ForemanTemplateCardProps) {
    const t = useTranslations('foreman.template')
    const verdict = answered && verdictOf(answered)
    const template = loaded.status === 'found' ? loaded.template : null

    return (
        // The mark rests on the board's top-left corner, the right one being where a price sits, and
        // only its top third hangs over the edge, so the block reserves that sliver above itself:
        // the message stack clips anything drawn outside it.
        <div className={cn('relative mb-2', verdict && 'mt-3')}>
            {verdict && (
                <TooltipLabeled label={t(verdict.labelKey)}>
                    <Icon icon={verdict.icon} size="sm" className={cn('absolute -top-3 left-2 z-10 bg-card shadow-lg shadow-black/40', verdict.className)} />
                </TooltipLabeled>
            )}
            {template ? <TemplateTile template={template} /> : <TemplateTileSkeleton />}
        </div>
    )
}
