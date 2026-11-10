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

// The candidates, as cards rather than as a numbered list in prose. This is the step where someone
// decides whether Rerun is for them, and a template reads as a team far better than it reads as a
// paragraph.
//
// One template is not three: it is the one they arrived on, so it gets the library's own card,
// board capture included, with its actions under it. Several are a choice, and a choice reads as a
// list, which carries its actions in its own rows.

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
    // Called whatever is rendered: a hook cannot hang on the shape of the arguments.
    const loaded = useTemplateBySlug(single?.slug ?? null)

    // A slug the library no longer answers for falls back to the row below: a dead link must not
    // leave a hole in the conversation.
    if (single && loaded.status !== 'missing') {
        return (
            <>
                <ForemanTemplateCard loaded={loaded} answered={answered} />
                {!answered && <ForemanTemplateActions shown={single} allowCustom={allowCustom} onAnswer={onAnswer} />}
            </>
        )
    }

    if (answered) {
        // Replayed from the transcript after a reload: the pick is already made, so the cards become
        // the line of what was chosen rather than an invitation to choose again.
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
                    // The far-right slot, so the apps land on the same edge as they do on the plan
                    // card two messages later. A row carrying it stops being a <button> and becomes
                    // a keyboard-activated div, which PanelRow handles on its own.
                    actions={<ServiceIconRow slugs={template.connectors} />}
                    onClick={() => onAnswer({ answered: true, chosen: template.slug })}
                />
            ))}
            {allowCustom && <PanelRow title={t('buildElse')} description={t('buildElseDescription')} leading={<Icon icon={Wand2} className="size-4 shrink-0 text-muted-foreground" />} onClick={() => onAnswer({ answered: true, custom: true })} />}
            {/* Le composer s'efface tant que la liste attend : sans cette sortie, un
                `allow_custom` à false laisserait la conversation close sur un choix qu'on refuse. */}
            <Button size="sm" variant="ghost" className="self-start text-muted-foreground" onClick={() => onAnswer({ answered: false })}>
                {t('notNow')}
            </Button>
        </div>
    )
}
