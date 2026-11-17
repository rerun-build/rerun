'use client'

import { AuthStageBoard } from '@/components/auth/AuthStageBoard'
import { shownTeam, type BoardTeam, type BoardTeams } from '@/lib/onboarding/board-teams'
import { appsOfRole } from '@/lib/onboarding/role-apps'
import { faviconUrl } from '@/lib/onboarding/site-favicon'
import { cn } from '@/lib/utils'
import type { TemplateCategory } from '@rerun/contracts'
import { TemplateBoardPreview } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

// What the answers have drawn so far.
export type OnboardingScene = {
    // Read off the site they gave, once it reads as an address. `name` lands a beat later.
    company: { domain: string; name: string | null } | null
    industry: TemplateCategory | null
    role: string
    invites: string[]
    // What they arrived for (a template, a shared coworker): it holds the board from start to end.
    focus: BoardTeam | null
}

export const EMPTY_SCENE: OnboardingScene = { company: null, industry: null, role: '', invites: [], focus: null }

const CHIP_MOTION = { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.2 } }

function CompanyChip({ domain, name }: { domain: string; name: string }) {
    const [failed, setFailed] = useState(false)
    return (
        <motion.div {...CHIP_MOTION} className="flex max-w-full items-center gap-2 rounded-full border bg-background/90 py-1 pr-3 pl-1.5 shadow-sm backdrop-blur">
            {failed ? (
                <span className="size-5 shrink-0 rounded-full bg-muted" />
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={faviconUrl(domain)} alt="" className="size-5 shrink-0 rounded-full" onError={() => setFailed(true)} />
            )}
            <span className="truncate text-sm font-medium">{name}</span>
        </motion.div>
    )
}

// The board their answers staff: a team at work before they say anything, the coworkers of their line
// of work once the site is read or the industry picked (it drops in again on every change), the apps
// of their role lit once they say what they do, and the people they invite at its foot.
export function OnboardingBoard({ teams, scene, className, maxZoom = 2.2 }: { teams: BoardTeams; scene: OnboardingScene; className?: string; maxZoom?: number }) {
    const t = useTranslations('onboarding.industries')
    const team = shownTeam(teams, scene.industry, scene.focus)
    const lit = useMemo(() => appsOfRole(scene.role), [scene.role])

    return (
        <div className={cn('relative overflow-hidden bg-background', className)}>
            {team ? <TemplateBoardPreview key={team.id} agents={team.agents} connectors={team.connectors} highlightedConnectorSlugs={lit} maxZoom={maxZoom} alive className="size-full" /> : <AuthStageBoard />}
            <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap items-center gap-2">
                <AnimatePresence mode="popLayout">
                    {scene.company?.name && <CompanyChip key={scene.company.domain} domain={scene.company.domain} name={scene.company.name} />}
                    {scene.industry && !scene.focus && (
                        <motion.div key={scene.industry} {...CHIP_MOTION}>
                            <Badge size="sm" tone="green">
                                {t(scene.industry)}
                            </Badge>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            {scene.invites.length > 0 && (
                <div className="pointer-events-none absolute bottom-4 left-4 flex -space-x-2">
                    <AnimatePresence>
                        {scene.invites.map(email => (
                            <motion.span
                                key={email}
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                title={email}
                                className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium uppercase"
                            >
                                {email.charAt(0)}
                            </motion.span>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    )
}
