'use client'

import { IsoGrid } from '@rerun/ui/iso-grid'
import { useKitTranslations } from '@rerun/ui/locale'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import type { AgentLink, IsoAgent, SpacePublic } from '@/lib/board/types'
import { containerFromSpace, tileFromAgent } from '@/lib/board/iso-adapter'
import type { StageScript } from './auth-stage-board'
import { stageLinkId } from './auth-stage-board'
import { useStageScript } from './useStageScript'

// Décor des anciennes surfaces d'auth en deux colonnes (/invite et /creator/join). Comme la scène
// plein cadre, il joue une histoire écrite plutôt que de tirer des statuts et des liens au hasard :
// un audit attend sa relecture, des leads passent à l'outreach avant l'approbation de la campagne,
// puis une alerte prix attend une décision. Chaque `waiting_human` vient donc après du travail et
// repart une fois l'accord donné.

// Disposition locale, volontairement plus aérée que la démo dashboard (agents collés) : un grand
// space et des agents espacés d'une case (chaque agent occupe un bloc 2×2, AGENT_SPAN=2).
const DEMO_SPACE: Omit<SpacePublic, 'name'> = {
    id: 'auth-space-1',
    workspace_id: 1,
    col_start: 2,
    row_start: 2,
    col_end: 11,
    row_end: 11,
    created_at: null,
}

const DEMO_AGENTS: IsoAgent[] = [
    { id: 'demo-agent-seo', name: 'SEO Analyst', handle: 'seo_analyst', templateId: null, description: 'Audit SEO, keywords, backlinks', status: 'idle', position: { col: 3, row: 3 }, workspaceId: 1, spaceId: 'auth-space-1', disabledAt: null, disabledReason: null },
    { id: 'demo-agent-linkedin', name: 'LinkedIn Outreach', handle: 'linkedin_outreach', templateId: null, description: 'Posts, engagement, prospection', status: 'idle', position: { col: 8, row: 3 }, workspaceId: 1, spaceId: 'auth-space-1', disabledAt: null, disabledReason: null },
    { id: 'demo-agent-leads', name: 'Lead Scraper', handle: 'lead_scraper', templateId: null, description: 'Scraping de leads Maps / Search', status: 'idle', position: { col: 3, row: 8 }, workspaceId: 1, spaceId: 'auth-space-1', disabledAt: null, disabledReason: null },
    { id: 'demo-agent-pricing', name: 'Pricing Watch', handle: 'pricing_watch', templateId: null, description: 'Veille prix concurrents', status: 'idle', position: { col: 8, row: 8 }, workspaceId: 1, spaceId: 'auth-space-1', disabledAt: null, disabledReason: null },
]

const SEO = 'demo-agent-seo'
const OUTREACH = 'demo-agent-linkedin'
const LEADS = 'demo-agent-leads'
const PRICING = 'demo-agent-pricing'
const LEAD_HANDOFF = stageLinkId(LEADS, OUTREACH)

// Le cycle commence par deux tâches en parallèle. L'audit demande une relecture ; le scraper passe
// ses leads à l'agent d'outreach, qui prépare la campagne et attend son approbation avant l'envoi.
// La veille prix prend ensuite le relais et ne répond jamais seule à un changement sensible.
export const AUTH_ISO_SCRIPT: StageScript = {
    startAt: 900,
    period: 72_000,
    frames: [
        { at: 0, changes: [
            { agent: SEO, status: 'working', links: [] },
            { agent: LEADS, status: 'working', links: [] },
        ] },
        { at: 6_000, changes: [{ agent: PRICING, status: 'working', links: [] }] },
        { at: 10_000, changes: [
            { agent: SEO, status: 'waiting_human', links: [] },
            { agent: LEADS, status: 'working', links: [LEAD_HANDOFF] },
            { agent: OUTREACH, status: 'working', links: [LEAD_HANDOFF] },
        ] },
        { at: 18_000, changes: [{ agent: PRICING, status: 'waiting_human', links: [] }] },
        { at: 20_000, changes: [
            { agent: LEADS, status: 'idle', links: [] },
            { agent: OUTREACH, status: 'working', links: [] },
        ] },
        { at: 22_000, changes: [
            { agent: SEO, status: 'working', links: [] },
            { agent: OUTREACH, status: 'waiting_human', links: [] },
        ] },
        { at: 30_000, changes: [{ agent: PRICING, status: 'working', links: [] }] },
        { at: 34_000, changes: [
            { agent: SEO, status: 'idle', links: [] },
            { agent: OUTREACH, status: 'working', links: [] },
        ] },
        { at: 42_000, changes: [{ agent: PRICING, status: 'idle', links: [] }] },
        { at: 45_000, changes: [{ agent: LEADS, status: 'working', links: [] }] },
        { at: 46_000, changes: [{ agent: OUTREACH, status: 'idle', links: [] }] },
        { at: 57_000, changes: [{ agent: LEADS, status: 'idle', links: [] }] },
        { at: 58_000, changes: [{ agent: SEO, status: 'working', links: [] }] },
        { at: 62_000, changes: [{ agent: PRICING, status: 'working', links: [] }] },
        { at: 64_000, changes: [{ agent: OUTREACH, status: 'working', links: [] }] },
    ],
}

const SCRIPTED_LINKS = new Map<string, AgentLink>([
    [LEAD_HANDOFF, { source: LEADS, target: OUTREACH }],
])

export function AuthIsoBackground() {
    const t = useTranslations('auth.isoBackground')
    const tKit = useKitTranslations()
    const { statuses, hotLinks } = useStageScript({ script: AUTH_ISO_SCRIPT, enabled: true })
    const container = useMemo(() => containerFromSpace({ ...DEMO_SPACE, name: t('boxName') }, tKit), [t, tKit])

    const agents = useMemo(
        () => DEMO_AGENTS.map(agent => ({ ...agent, status: statuses[agent.id] ?? agent.status })),
        [statuses],
    )
    const links = useMemo(() => {
        const hot = new Set(Object.values(hotLinks).flat())
        return [...hot].flatMap(id => {
            const link = SCRIPTED_LINKS.get(id)
            return link ? [link] : []
        })
    }, [hotLinks])
    // Une attente humaine prend la priorité visuelle ; sinon le halo suit une tâche en cours.
    const selectedId = agents.find(agent => agent.status === 'waiting_human')?.id
        ?? agents.find(agent => agent.status === 'working')?.id
        ?? null

    return (
        <IsoGrid
            tiles={agents.map(a => tileFromAgent(a))}
            containers={[container]}
            liveLinks={links}
            selectedTileId={selectedId}
            worldAnchor={{ left: '50%', top: '50%' }}
            initialZoomDesktop={1.5}
            scrollGestures={false}
        />
    )
}
