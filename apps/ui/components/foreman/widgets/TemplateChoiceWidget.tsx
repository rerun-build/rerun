'use client'

import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

import { ServiceIconRow } from '@/components/services/ServiceIconRow'
import { Button } from '@/components/ui/button'
import { PanelRow } from '@/components/ui/panel-row'
import { Icon } from '@/components/ui/icon'
import { useTemplateBySlug } from '@/hooks/useTemplateBySlug'
import { Package, Wand2 } from '@/lib/icons'

import { ForemanTemplateActions } from './ForemanTemplateActions'
import { ForemanTemplateCard } from './ForemanTemplateCard'
import { readOutput, readTemplates, type TemplateChoice } from './template-choice'

type TemplateChoiceWidgetProps = {
    input: unknown
    output?: unknown
    onAnswer: (answer: TemplateChoice) => void
}

export function TemplateChoiceWidget({ input, output, onAnswer }: TemplateChoiceWidgetProps) {
    const t = useTranslations('foreman.template')
    const { templates, allowCustom } = readTemplates(input)
    const answered = readOutput(output)
    const single = templates.length === 1 ? templates[0] : null
    const loaded = useTemplateBySlug(single?.slug ?? null)

    if (single && loaded.status !== 'missing') {
        return (
            <>
                <ForemanTemplateCard loaded={loaded} answered={answered} />
                {!answered && <ForemanTemplateActions shown={single} allowCustom={allowCustom} onAnswer={onAnswer} />}
            </>
        )
    }

    if (answered) {
        const picked = answered.answered && 'chosen' in answered ? (templates.find(template => template.slug === answered.chosen)?.title ?? answered.chosen) : answered.answered ? t('somethingCustom') : t('skipped')
        return (
            <div className="mb-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
                <p className="text-muted-foreground text-xs">{t('label')}</p>
                <p className="text-foreground">{picked}</p>
            </div>
        )
    }

    return (
        <div className="mb-2 flex flex-col gap-2">
            {templates.map(template => (
                <PanelRow
                    key={template.slug}
                    title={template.title}
                    description={template.why}
                    leading={<Icon icon={Package} className="size-4 shrink-0 text-muted-foreground" />}
                    meta={
                        template.agents !== undefined ? (
                            <Badge tone="neutral" size="sm">
                                {t('agents', { count: template.agents })}
                            </Badge>
                        ) : undefined
                    }
                    actions={<ServiceIconRow slugs={template.connectors} />}
                    onClick={() => onAnswer({ answered: true, chosen: template.slug })}
                />
            ))}
            {allowCustom && <PanelRow title={t('buildElse')} description={t('buildElseDescription')} leading={<Icon icon={Wand2} className="size-4 shrink-0 text-muted-foreground" />} onClick={() => onAnswer({ answered: true, custom: true })} />}
            <Button size="sm" variant="ghost" className="self-start text-muted-foreground" onClick={() => onAnswer({ answered: false })}>
                {t('notNow')}
            </Button>
        </div>
    )
}
