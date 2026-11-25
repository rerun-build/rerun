'use client'

import type { StarterRole } from '@/lib/onboarding/starter-roles.server'
import { promiseKey } from '@/lib/onboarding/promise-key'
import { starterPack } from '@/lib/onboarding/starter-packs'
import type { SectorId } from '@/lib/onboarding/sectors'
import type { TemplateCategory } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { CoinStack } from '@rerun/ui/new-agent'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { CAST } from './cast'
import { ForemanAccent } from './ForemanAccent'
import { PanelPage } from './PanelPage'
import { PanelStage, PanelWindow } from './PanelStage'

const MAX_COWORKERS = 5

const ACRONYMS = /\b(b2b|crm|hr|seo)\b/gi

const readableSlug = (slug: string) =>
    slug
        .replace(/-/g, ' ')
        .replace(/^./, letter => letter.toUpperCase())
        .replace(ACRONYMS, acronym => acronym.toUpperCase())

// The starter team of their line of work, the one the Chief of Staff offers at the end: every pick
// redraws it. The job and the apps of each coworker come from its template.
export function TeamPanel({ industry, sector, label, roles }: { industry: TemplateCategory | null; sector: SectorId | null; label: string; roles: Record<string, StarterRole> }) {
    const t = useTranslations('onboarding')
    const team = starterPack(industry, sector).slice(0, MAX_COWORKERS)

    return (
        <PanelPage title={t('sector.panel.title')} line={t('sector.panel.line')}>
            <PanelStage width={480} height={44 + 16 + MAX_COWORKERS * 62} accent={<ForemanAccent facing="left" className="right-8" />}>
                <PanelWindow className="h-auto">
                    <div className="flex h-11 items-center gap-2 border-b border-border px-4 text-xs text-muted-foreground">
                        <span className="flex-1 font-medium">{t('sector.panel.heading')}</span>
                        <span className="max-w-48 truncate">{label || t('sector.panel.anyone')}</span>
                    </div>
                    <ul className="space-y-1 p-2 [--cut:var(--popover)]">
                        <AnimatePresence mode="popLayout" initial={false}>
                            {team.map((card, index) => {
                                const role = roles[card.template]
                                return (
                                    <motion.li key={`${sector ?? industry}-${card.template}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25, delay: index * 0.06 }} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                                        <AgentBuddy agentId={card.template} look={CAST[index % CAST.length].look} size={36} facing="right" className="shrink-0" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[15px] leading-5 font-medium">{t(`promises.${promiseKey(card.promise)}`)}</span>
                                            <span className="block truncate text-[13px] leading-[18px] text-muted-foreground">{role?.title ?? readableSlug(card.template)}</span>
                                        </span>
                                        {role && role.apps.length > 0 && <CoinStack apps={role.apps} size={24} overlap={6} />}
                                    </motion.li>
                                )
                            })}
                        </AnimatePresence>
                    </ul>
                </PanelWindow>
            </PanelStage>
        </PanelPage>
    )
}
