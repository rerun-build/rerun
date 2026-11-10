'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Icon } from '@/components/ui/icon'
import { ShieldCheck } from '@/lib/icons'
import { TemplateDetailAbout } from '@/components/templates/TemplateDetailAbout'
import { TemplateDetailAgentCard } from '@/components/templates/TemplateDetailAgentCard'
import { TemplateDetailFooter } from '@/components/templates/TemplateDetailFooter'
import { TemplateDetailMedia } from '@/components/templates/TemplateDetailMedia'
import { CardCarousel, ScrollFade, Stripes } from '@rerun/ui/primitives'
import { serviceIconProps } from '@/lib/services/icons'
import { type LibraryTemplate } from '@/lib/templates/library'
import { priceLabel, templateCategoryLabel } from '@rerun/contracts'
import { cn } from '@/lib/utils'

export function TemplateDetailPanel({ template, showStatus, onImported }: { template: LibraryTemplate; showStatus: boolean; onImported: () => void }) {
    const t = useTranslations('templates.detail')
    const tPrice = useTranslations('templates.price')
    const tCategory = useTranslations('templates.categories')
    const locale = useLocale()
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
                        <h3 className="text-base font-medium">{template.title}</h3>
                        {template.tagline && <p className="text-xs text-muted-foreground">{template.tagline}</p>}
                    </div>

                    <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-lg border border-border/60 bg-muted/30 p-3">
                        <Stripes />
                        <MetaRow label={t('price')} value={priceLabel(template.pricing, tPrice, locale)} />
                        <MetaRow label={t('coworkers')} value={String(template.agentCount)} />
                        {template.connectors.length > 0 && <MetaRow label={t('apps')} value={String(template.connectors.length)} />}
                        <MetaRow label={t('setupTime')} value={t('minutes', { minutes: template.setupMinutes })} />
                        <MetaRow label={t('category')} value={templateCategoryLabel(template.category, tCategory)} />
                    </div>

                    {template.longDescription && (
                        <Section title={t('about')}>
                            <TemplateDetailAbout key={template.slug} content={template.longDescription} />
                        </Section>
                    )}

                    {template.connectors.length > 0 && (
                        <Section title={t('whatYouNeed')}>
                            <ul className="grid grid-cols-2 gap-1.5">
                                {template.connectors.map(connector => (
                                    <li key={connector.slug} className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
                                        <Icon {...serviceIconProps(connector.icon)} size="xs" />
                                        <p className="min-w-0 flex-1 truncate text-xs font-medium">{connector.name}</p>
                                    </li>
                                ))}
                            </ul>
                        </Section>
                    )}

                    {template.agents.length > 0 && (
                        <Section title={t('coworkers')} count={template.agents.length}>
                            {/* A lone agent takes the full width; from two on, cards leave the next one peeking
                                out to hint at the scroll. */}
                            <CardCarousel
                                label={t('carousel')}
                                fadeClassName="from-popover"
                                className="gap-3"
                                itemClassName={cn('shrink-0 snap-center', template.agents.length > 1 ? 'w-[85%]' : 'w-full')}
                            >
                                {template.agents.map(agent => (
                                    <TemplateDetailAgentCard key={agent.key} agent={agent} connectors={template.connectors} />
                                ))}
                            </CardCarousel>
                        </Section>
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

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {title}
                {count !== undefined && <span className="text-muted-foreground/60"> · {count}</span>}
            </p>
            {children}
        </div>
    )
}
