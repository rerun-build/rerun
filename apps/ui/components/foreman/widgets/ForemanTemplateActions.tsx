'use client'

import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

import type { ShownTemplate, TemplateChoice } from './template-choice'

// The decision the card above asks for, right under it. Same shell as the QuestionForm an agent
// asks through, because it answers the same way. Apart from the card because it leaves once the
// decision is made, where the card stays with its verdict.

type ForemanTemplateActionsProps = {
    shown: ShownTemplate
    allowCustom: boolean
    onAnswer: (answer: TemplateChoice) => void
}

export function ForemanTemplateActions({ shown, allowCustom, onAnswer }: ForemanTemplateActionsProps) {
    const t = useTranslations('foreman.template')
    return (
        <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30 p-3">
            <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={7} />
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => onAnswer({ answered: true, chosen: shown.slug })}>
                    {t('install')}
                </Button>
                {allowCustom && (
                    <Button size="sm" variant="secondary" onClick={() => onAnswer({ answered: true, custom: true })}>
                        {t('buildElse')}
                    </Button>
                )}
                {/* Le composer s'efface tant que la carte attend : sans cette sortie, la conversation
                    reste close sur une carte que personne ne veut. */}
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onAnswer({ answered: false })}>
                    {t('notNow')}
                </Button>
            </div>
        </div>
    )
}
