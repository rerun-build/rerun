'use client'

import { IsoGrid } from '@rerun/ui/iso-grid'
import { useMemo } from 'react'
import type { AgentLink, IsoAgent, SpacePublic } from '@/lib/board/types'
import { containerFromSpace, tileFromAgent } from '@/lib/board/iso-adapter'
import type { StageScript } from './auth-stage-board'
import { stageLinkId } from './auth-stage-board'
import { useStageScript } from './useStageScript'

const DEMO_SPACE: SpacePublic = {
    id: 'auth-space-1',
    workspace_id: 1,
    name: 'Growth Ops',
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
    const { statuses, hotLinks } = useStageScript({ script: AUTH_ISO_SCRIPT, enabled: true })

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
    const selectedId = agents.find(agent => agent.status === 'waiting_human')?.id
        ?? agents.find(agent => agent.status === 'working')?.id
        ?? null

    return (
        <IsoGrid
            tiles={agents.map(a => tileFromAgent(a))}
            containers={[containerFromSpace(DEMO_SPACE)]}
            liveLinks={links}
            selectedTileId={selectedId}
            worldAnchor={{ left: '50%', top: '50%' }}
            initialZoomDesktop={1.5}
            scrollGestures={false}
        />
    )
}
