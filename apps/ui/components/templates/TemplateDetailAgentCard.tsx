'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/icon'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { Stripes } from '@rerun/ui/primitives'
import { CalendarClock, WebhookIcon, Zap, type LucideIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { scheduleLabel } from '@/lib/templates/labels'
import type { TemplateAgent, TemplateConnector } from '@rerun/contracts'

const MAX_CONNECTORS = 6
const MAX_SKILLS = 4
const MAX_SCHEDULES = 3
const MAX_TRIGGERS = 3

// A row the caller writes itself, for what the card cannot read off the agent: a shared copy carries
// memories, files and keys that exist nowhere in TemplateAgent.
export type AgentCardEntry = { key: string; icon: LucideIcon; title: string; subtitle?: string }

// A fact that only holds on one surface, and only about one section, so it sits under that section's
// own title rather than in a paragraph further down repeating which section it meant.
export type AgentCardNotes = { connectors?: string; triggers?: string }

export function TemplateDetailAgentCard({ agent, connectors, comesWith, notes }: { agent: TemplateAgent; connectors: TemplateConnector[]; comesWith?: AgentCardEntry[]; notes?: AgentCardNotes }) {
    const t = useTranslations('templates.agentCard')
    const locale = useLocale()
    const agentConnectors = connectors.filter(connector => agent.connectorSlugs.includes(connector.slug))
    const shownConnectors = agentConnectors.slice(0, MAX_CONNECTORS)
    const hiddenConnectors = agentConnectors.slice(MAX_CONNECTORS)
    const shownSkills = agent.skills.slice(0, MAX_SKILLS)
    const shownSchedules = agent.schedules.slice(0, MAX_SCHEDULES)
    const shownTriggers = agent.triggers.slice(0, MAX_TRIGGERS)

    return (
        <article className="relative flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-border/60 bg-card p-3">
            <header className="relative -mx-3 -mt-3 flex flex-col gap-1.5 px-3 pt-3">
                <Stripes />
                <div className="relative flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{agent.name}</p>
                    {agent.role && <span className="shrink-0 text-[10px] text-muted-foreground">{agent.role}</span>}
                </div>
                {agent.description && <p className="relative line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>}
            </header>

            {/* First, and above what the agent is made of: someone opening a shared copy is deciding
                whether to take it, and what travels with it is the part of that decision the rest of
                the card cannot answer. */}
            {comesWith && comesWith.length > 0 && (
                <CardSection title={t('comesWith')}>
                    {comesWith.map(entry => (
                        <AgentListRow key={entry.key} icon={entry.icon} title={entry.title} subtitle={entry.subtitle} />
                    ))}
                </CardSection>
            )}

            {agentConnectors.length > 0 && (
                <CardSection title={t('apps')} note={notes?.connectors}>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {shownConnectors.map(connector => (
                            <TooltipLabeled key={connector.slug} label={connector.name}>
                                <Icon {...serviceIconProps(connector.icon)} size="xs" />
                            </TooltipLabeled>
                        ))}
                        {hiddenConnectors.length > 0 && (
                            <TooltipLabeled
                                contentClassName="flex-col items-start gap-1"
                                label={hiddenConnectors.map(connector => (
                                    <span key={connector.slug}>{connector.name}</span>
                                ))}
                            >
                                <span className="inline-flex size-6 cursor-default items-center justify-center rounded-md border border-border bg-primary/5 text-[10px] font-medium text-muted-foreground">+{hiddenConnectors.length}</span>
                            </TooltipLabeled>
                        )}
                    </div>
                </CardSection>
            )}

            {agent.skills.length > 0 && (
                <CardSection title={t('skills')} count={agent.skills.length}>
                    {shownSkills.map(skill => (
                        <AgentListRow key={skill.name} icon={Zap} title={skill.name} subtitle={skill.description} />
                    ))}
                    {agent.skills.length > shownSkills.length && <MoreRow count={agent.skills.length - shownSkills.length} />}
                </CardSection>
            )}

            {agent.schedules.length > 0 && (
                <CardSection title={t('schedules')} count={agent.schedules.length}>
                    {shownSchedules.map(schedule => (
                        <AgentListRow key={schedule.name} icon={CalendarClock} title={schedule.name} subtitle={scheduleLabel(schedule.cron, locale)} />
                    ))}
                    {agent.schedules.length > shownSchedules.length && <MoreRow count={agent.schedules.length - shownSchedules.length} />}
                </CardSection>
            )}

            {agent.triggers.length > 0 && (
                <CardSection title={t('webhooks')} count={agent.triggers.length} note={notes?.triggers}>
                    {shownTriggers.map(trigger => (
                        <AgentListRow key={trigger.name} icon={WebhookIcon} title={trigger.name} subtitle={trigger.description || trigger.methods.join(' · ')} />
                    ))}
                    {agent.triggers.length > shownTriggers.length && <MoreRow count={agent.triggers.length - shownTriggers.length} />}
                </CardSection>
            )}
        </article>
    )
}

function CardSection({ title, count, note, children }: { title: string; count?: number; note?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <div className="flex flex-col gap-0.5">
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {title}
                    {count !== undefined && <span className="text-muted-foreground/60"> · {count}</span>}
                </h4>
                {note && <p className="text-[11px] text-muted-foreground/80">{note}</p>}
            </div>
            {children}
        </div>
    )
}

function AgentListRow({ icon: Glyph, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
    return (
        <div className="flex items-center gap-2.5">
            <Glyph className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
                <p className="truncate text-xs">{title}</p>
                {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
            </div>
        </div>
    )
}

function MoreRow({ count }: { count: number }) {
    const t = useTranslations('templates.agentCard')
    return <p className="pl-6 text-[11px] text-muted-foreground">{t('more', { count })}</p>
}
