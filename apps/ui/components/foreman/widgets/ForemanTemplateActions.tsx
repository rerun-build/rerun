'use client'

import { BorderBeam } from '@moldwright/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

import type { ShownTemplate, TemplateChoice } from './template-choice'

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
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onAnswer({ answered: false })}>
                    {t('notNow')}
                </Button>
            </div>
        </div>
    )
}
