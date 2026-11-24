'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Icon } from '@/components/ui/icon'
import { ShieldCheck } from '@/lib/icons'
import { TemplateDetailAbout } from '@/components/templates/TemplateDetailAbout'
import { TemplateDetailAgentCard } from '@/components/templates/TemplateDetailAgentCard'
import { TemplateDetailApps } from '@/components/templates/TemplateDetailApps'
import { TemplateDetailFooter } from '@/components/templates/TemplateDetailFooter'
import { TemplateDetailMedia } from '@/components/templates/TemplateDetailMedia'
import { TemplateDetailSection } from '@/components/templates/TemplateDetailSection'
import { TemplateDetailUseCases } from '@/components/templates/TemplateDetailUseCases'
import { CardCarousel, ScrollFade, Stripes } from '@rerun/ui/primitives'
import { type LibraryTemplate } from '@/lib/templates/library'
import { templateHeadline } from '@/lib/templates/library-view'
import { coworkerUseCases, type UseCase } from '@/lib/templates/use-cases'
import { priceLabel, templateCategoryLabel } from '@rerun/contracts'
import { cn } from '@/lib/utils'

export function TemplateDetailPanel({
    template,
    showStatus,
    onImported,
    onSelectUseCase,
}: {
    template: LibraryTemplate
    showStatus: boolean
    onImported: () => void
    // Given by the library, which can open a use case beside its lists. Without it the skills stay on
    // each coworker's card.
    onSelectUseCase?: (useCase: UseCase) => void
}) {
    const t = useTranslations('templates.detail')
    const tPrice = useTranslations('templates.price')
    const tCategory = useTranslations('templates.categories')
    const locale = useLocale()
    const { headline, subline } = templateHeadline(template)
    return (
        // w-full min-w-0 : la dialog qui accueille ce panneau est une grille, et une piste `auto`
        // s'élargit jusqu'à la min-content de son contenu. Sans ça, une URL dans la description
        // suffit à pousser le panneau hors de la dialog, qui le rogne à droite.
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <ScrollFade className="min-h-0 flex-1">
                {/* Keyed on the slug: the active media slot has to reset when another template is picked. */}
                <TemplateDetailMedia key={template.slug} template={template} showStatus={showStatus} />

                <div className="flex flex-col gap-5 p-5">
                    <div className="space-y-1.5">
                        <h3 className="text-base font-medium">{headline}</h3>
                        {subline && <p className="text-xs leading-relaxed text-muted-foreground">{subline}</p>}
                    </div>

                    {onSelectUseCase &&
                        coworkerUseCases(template).map(({ agent, useCases }) => (
                            <TemplateDetailUseCases key={agent.key} title={template.agents.length > 1 ? agent.name : t('useCases')} useCases={useCases} onSelect={onSelectUseCase} />
                        ))}

                    <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-lg border border-border/60 bg-muted/30 p-3">
                        <Stripes />
                        <MetaRow label={t('price')} value={priceLabel(template.pricing, tPrice, locale)} />
                        <MetaRow label={t('coworkers')} value={String(template.agentCount)} />
                        {template.connectors.length > 0 && <MetaRow label={t('apps')} value={String(template.connectors.length)} />}
                        <MetaRow label={t('setupTime')} value={t('minutes', { minutes: template.setupMinutes })} />
                        <MetaRow label={t('category')} value={templateCategoryLabel(template.category, tCategory)} />
                    </div>

                    {template.longDescription && (
                        <TemplateDetailSection title={t('about')}>
                            <TemplateDetailAbout key={template.slug} content={template.longDescription} />
                        </TemplateDetailSection>
                    )}

                    <TemplateDetailApps connectors={template.connectors} />

                    {template.agents.length > 0 && (
                        <TemplateDetailSection title={t('coworkers')} count={template.agents.length}>
                            {/* A lone agent takes the full width; from two on, cards leave the next one peeking
                                out to hint at the scroll. */}
                            <CardCarousel
                                label={t('carousel')}
                                fadeClassName="from-popover"
                                className="gap-3"
                                itemClassName={cn('shrink-0 snap-center', template.agents.length > 1 ? 'w-[85%]' : 'w-full')}
                            >
                                {template.agents.map(agent => (
                                    <TemplateDetailAgentCard key={agent.key} agent={onSelectUseCase ? { ...agent, skills: [] } : agent} connectors={template.connectors} />
                                ))}
                            </CardCarousel>
                        </TemplateDetailSection>
                    )}

                    {template.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {template.tags.map(tag => (
                                <span key={tag} className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    <Alert variant="warning" stripes className="grid-cols-[auto_1fr] gap-x-3 gap-y-0">
                        <Icon icon={ShieldCheck} size="sm" className="row-span-2 self-center" />
                        <AlertTitle className="col-start-2 leading-tight">{t('securityTitle')}</AlertTitle>
                        <AlertDescription className="col-start-2 leading-snug">
                            {t('securityBody')}
                        </AlertDescription>
                    </Alert>
                </div>
            </ScrollFade>

            <TemplateDetailFooter template={template} onImported={onImported} />
        </div>
    )
}

function MetaRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="relative flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="whitespace-nowrap font-medium">{value}</span>
        </div>
    )
}
