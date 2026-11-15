import { AGENT_SPAN, GRID_SIZE, TILE_H, TILE_W, agentTileStyle, connectorTileStyle, hashUnit } from '@rerun/ui/iso-grid'
import type { Container, GridPosition, RoutedLink, RoutedTile, Tile, TileLink } from '@rerun/ui/iso-grid'

import { containerFromSpace } from '@/lib/board/iso-adapter'
import { CABLE_DRAW_MS, routeAlone, routeBoard, routeHitsBox, routesCross, tileAxisBox } from '@/lib/board/iso-route'
import type { AxisRoute } from '@/lib/board/iso-route'
import type { SpacePublic } from '@/lib/board/types'

const ICON_BASE = '/services'

const CONNECTORS = {
    ahrefs: { name: 'Ahrefs', icon: `${ICON_BASE}/ahrefs.png?v=1783946921645` },
    apollo: { name: 'Apollo', icon: `${ICON_BASE}/apollo.png?v=1781628422981&tone=dark` },
    clay: { name: 'Clay', icon: `${ICON_BASE}/clay.png?v=1781628421249` },
    gmail: { name: 'Gmail', icon: `${ICON_BASE}/gmail.svg?v=1784542934049` },
    'google-calendar': { name: 'Google Calendar', icon: `${ICON_BASE}/google-calendar.svg?v=1785513263907` },
    'google-docs': { name: 'Google Docs', icon: `${ICON_BASE}/google-docs.svg?v=1785513264564` },
    'google-sheets': { name: 'Google Sheets', icon: `${ICON_BASE}/google-sheets.svg?v=1785513263623` },
    hubspot: { name: 'HubSpot', icon: `${ICON_BASE}/hubspot.svg?v=1781610001204` },
    instagram: { name: 'Instagram', icon: `${ICON_BASE}/instagram.svg?v=1788341143609` },
    intercom: { name: 'Intercom', icon: `${ICON_BASE}/intercom.svg?v=1787908747442&tone=dark` },
    linear: { name: 'Linear', icon: `${ICON_BASE}/linear.svg?v=1784279892420` },
    linkedin: { name: 'LinkedIn', icon: `${ICON_BASE}/linkedin.svg?v=1787241159350` },
    notion: { name: 'Notion', icon: `${ICON_BASE}/notion.svg?v=1782197362992&tone=dark` },
    slack: { name: 'Slack', icon: `${ICON_BASE}/slack.png?v=1784305607775` },
    stripe: { name: 'Stripe', icon: `${ICON_BASE}/stripe.svg?v=1781006680237` },
    tiktok: { name: 'TikTok', icon: `${ICON_BASE}/tiktok.svg?v=1788341143888&tone=dark` },
    wordpress: { name: 'WordPress', icon: `${ICON_BASE}/wordpress.svg?v=1783956619179` },
    x: { name: 'X', icon: `${ICON_BASE}/x.svg?v=1784008396096&tone=dark` },
} satisfies Record<string, { name: string; icon: string; highlight?: boolean }>

type ConnectorSlug = keyof typeof CONNECTORS

const HALF_W = TILE_W / 2
const HALF_H = TILE_H / 2
const WORLD_TOP = (GRID_SIZE / 2) * TILE_H

const BOX_SPAN = 5
const CONNECTOR_RING = 2
const CONNECTOR_REACH = 5
const CONNECTOR_SPACING = 2
const CENTER_KEEPOUT = 150

const CONNECTOR_KEEP_IN = { x: 400, y: 264 }

function at(x: number, y: number, span: number): GridPosition {
    const u = Math.round(x / HALF_W - 1)
    const exact = (y + WORLD_TOP - span * HALF_H) / HALF_H
    let w = Math.round(exact)
    if ((u + w) % 2 !== 0) w += exact > w ? 1 : -1
    return { col: (u + w) / 2, row: (w - u) / 2 }
}

const cellScreenX = (cell: GridPosition) => (cell.col - cell.row) * HALF_W + HALF_W
const cellScreenY = (cell: GridPosition) => (cell.col + cell.row) * HALF_H - WORLD_TOP + HALF_H

function blockDistance(anchor: GridPosition, span: number, cell: GridPosition) {
    const dc = Math.max(anchor.col - cell.col, 0, cell.col - (anchor.col + span - 1))
    const dr = Math.max(anchor.row - cell.row, 0, cell.row - (anchor.row + span - 1))
    return Math.max(dc, dr)
}

const chebyshev = (a: GridPosition, b: GridPosition) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))

const LEAD_SCRAPER = 'auth-lead-scraper'
const OUTREACH_WRITER = 'auth-outreach-writer'
const MEETING_BOOKER = 'auth-meeting-booker'
const TICKET_ROUTER = 'auth-ticket-router'
const INBOX_TRIAGE = 'auth-inbox-triage'
const SEO_ANALYST = 'auth-seo-analyst'
const BLOG_WRITER = 'auth-blog-writer'
const SOCIAL_EDITOR = 'auth-social-editor'
const INVOICE_CHASER = 'auth-invoice-chaser'
const CRM_ENRICHER = 'auth-crm-enricher'

type StageAgent = { id: string; name: string }
type StageBox = { id: string; name: string; x: number; y: number; layout: AgentLayout; turns: number; agents: StageAgent[] }

const BOXES: StageBox[] = [
    {
        id: 'auth-box-growth',
        name: 'Growth',
        layout: 'wedge',
        turns: 3,
        x: -344,
        y: -186,
        agents: [
            { id: LEAD_SCRAPER, name: 'Lead Scraper' },
            { id: OUTREACH_WRITER, name: 'Outreach Writer' },
            { id: MEETING_BOOKER, name: 'Meeting Booker' },
        ],
    },
    {
        id: 'auth-box-support',
        name: 'Support',
        layout: 'iso-col',
        turns: 0,
        x: 306,
        y: -150,
        agents: [
            { id: TICKET_ROUTER, name: 'Ticket Router' },
            { id: INBOX_TRIAGE, name: 'Inbox Triage' },
        ],
    },
    {
        id: 'auth-box-content',
        name: 'Content',
        layout: 'stair',
        turns: 1,
        x: -298,
        y: 168,
        agents: [
            { id: SEO_ANALYST, name: 'SEO Analyst' },
            { id: BLOG_WRITER, name: 'Blog Writer' },
            { id: SOCIAL_EDITOR, name: 'Social Editor' },
        ],
    },
    {
        id: 'auth-box-revenue',
        name: 'Revenue',
        layout: 'abreast',
        turns: 1,
        x: 352,
        y: 132,
        agents: [
            { id: INVOICE_CHASER, name: 'Invoice Chaser' },
            { id: CRM_ENRICHER, name: 'CRM Enricher' },
        ],
    },
]

type ScriptStep = {
    agent: string
    tool?: ConnectorSlug
    hold: number
    awaitHuman?: number
    with?: string
}

type ScriptThread = { id: string; at: number; steps: ScriptStep[] }

const THREADS: ScriptThread[] = [
    {
        id: 'lead',
        at: 0,
        steps: [
            { agent: LEAD_SCRAPER, tool: 'apollo', hold: 4200 },
            { agent: LEAD_SCRAPER, tool: 'linkedin', hold: 3600 },
            { agent: OUTREACH_WRITER, tool: 'gmail', hold: 4400, awaitHuman: 4600 },
            { agent: MEETING_BOOKER, tool: 'google-calendar', hold: 11500, with: CRM_ENRICHER },
            { agent: CRM_ENRICHER, tool: 'clay', hold: 4000 },
            { agent: CRM_ENRICHER, tool: 'hubspot', hold: 3400 },
        ],
    },
    {
        id: 'ticket',
        at: 2600,
        steps: [
            { agent: INBOX_TRIAGE, tool: 'intercom', hold: 3600 },
            { agent: INBOX_TRIAGE, tool: 'notion', hold: 3200 },
            { agent: TICKET_ROUTER, tool: 'linear', hold: 4200 },
            { agent: TICKET_ROUTER, tool: 'slack', hold: 10500, with: BLOG_WRITER },
            { agent: BLOG_WRITER, tool: 'google-docs', hold: 4400 },
        ],
    },
    {
        id: 'paiement',
        at: 3000,
        steps: [
            { agent: INVOICE_CHASER, tool: 'stripe', hold: 4000 },
            { agent: CRM_ENRICHER, tool: 'clay', hold: 3600 },
        ],
    },
    {
        id: 'veille',
        at: 2000,
        steps: [
            { agent: SEO_ANALYST, tool: 'ahrefs', hold: 3800, awaitHuman: 4400 },
            { agent: SOCIAL_EDITOR, tool: 'x', hold: 3200 },
        ],
    },
    {
        id: 'relance',
        at: 12500,
        steps: [
            { agent: CRM_ENRICHER, tool: 'hubspot', hold: 3600 },
            { agent: INVOICE_CHASER, tool: 'stripe', hold: 3400 },
        ],
    },
    {
        id: 'article',
        at: 26000,
        steps: [
            { agent: SEO_ANALYST, tool: 'ahrefs', hold: 4200 },
            { agent: SEO_ANALYST, hold: 10000, with: BLOG_WRITER },
            { agent: BLOG_WRITER, tool: 'wordpress', hold: 4000, awaitHuman: 4200 },
            { agent: SOCIAL_EDITOR, tool: 'x', hold: 3400 },
            { agent: SOCIAL_EDITOR, tool: 'instagram', hold: 3000 },
            { agent: SOCIAL_EDITOR, tool: 'tiktok', hold: 3600 },
            { agent: INBOX_TRIAGE, tool: 'intercom', hold: 3600 },
        ],
    },
    {
        id: 'facture',
        at: 29000,
        steps: [
            { agent: INVOICE_CHASER, tool: 'google-sheets', hold: 3200 },
            { agent: INVOICE_CHASER, tool: 'stripe', hold: 4200, awaitHuman: 4000 },
            { agent: CRM_ENRICHER, tool: 'hubspot', hold: 3400 },
            { agent: MEETING_BOOKER, tool: 'google-calendar', hold: 3600 },
        ],
    },
    {
        id: 'doc',
        at: 27000,
        steps: [
            { agent: TICKET_ROUTER, tool: 'slack', hold: 8400 },
            { agent: INBOX_TRIAGE, tool: 'notion', hold: 3600 },
        ],
    },
    {
        id: 'bilan',
        at: 44000,
        steps: [
            { agent: TICKET_ROUTER, tool: 'linear', hold: 3400 },
            { agent: TICKET_ROUTER, hold: 11000, with: SEO_ANALYST },
            { agent: SEO_ANALYST, tool: 'ahrefs', hold: 3600 },
        ],
    },
    {
        id: 'suite',
        at: 45000,
        steps: [
            { agent: LEAD_SCRAPER, tool: 'linkedin', hold: 9000 },
            { agent: OUTREACH_WRITER, tool: 'gmail', hold: 3400 },
        ],
    },
]

const HANDOFF_MS = 1500
const HANDOFF_LEAD = 500
const RESUME_MS = 1300
const COLLAB_MIN_MS = 10_000
const CYCLE_PERIOD = 72_000

const LAYOUT_MAX = BOX_SPAN - AGENT_SPAN

const AGENT_LAYOUTS = {
    'iso-col': [{ col: 0, row: 1 }, { col: 3, row: 1 }],
    'iso-row': [{ col: 1, row: 0 }, { col: 1, row: 3 }],
    stacked: [{ col: 0, row: 0 }, { col: 3, row: 3 }],
    abreast: [{ col: 0, row: 3 }, { col: 3, row: 0 }],
    wedge: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 0, row: 3 }],
    stair: [{ col: 0, row: 0 }, { col: 3, row: 1 }, { col: 0, row: 3 }],
    fork: [{ col: 0, row: 0 }, { col: 2, row: 2 }, { col: 3, row: 0 }],
} satisfies Record<string, GridPosition[]>

type AgentLayout = keyof typeof AGENT_LAYOUTS

function turned(offset: GridPosition, turns: number): GridPosition {
    let { col, row } = offset
    for (let i = 0; i < turns; i++) {
        const next = { col: row, row: LAYOUT_MAX - col }
        col = next.col
        row = next.row
    }
    return { col, row }
}

type PlacedAgent = StageAgent & { cell: GridPosition; boxId: string }
type PlacedBox = { box: StageBox; anchor: GridPosition; agents: PlacedAgent[] }
type PlacedConnector = { id: string; agentId: string; slug: ConnectorSlug; cell: GridPosition }

const connectorId = (agent: string, slug: ConnectorSlug) => `${agent}::${slug}`

function placeBox(box: StageBox): PlacedBox {
    const anchor = at(box.x, box.y, BOX_SPAN)
    const layout = AGENT_LAYOUTS[box.layout]
    if (layout.length !== box.agents.length) throw new Error(`[auth-stage-board] la figure « ${box.layout} » ne pose pas ${box.agents.length} coworkers`)

    return {
        box,
        anchor,
        agents: box.agents.map((agent, index) => {
            const offset = turned(layout[index], box.turns)
            return { ...agent, boxId: box.id, cell: { col: anchor.col + offset.col, row: anchor.row + offset.row } }
        }),
    }
}

function toolsByAgent(): Map<string, ConnectorSlug[]> {
    const out = new Map<string, ConnectorSlug[]>()
    const seen = new Set<ConnectorSlug>()

    for (const thread of THREADS) {
        for (const step of thread.steps) {
            if (!step.tool || seen.has(step.tool)) continue
            seen.add(step.tool)
            out.set(step.agent, [...(out.get(step.agent) ?? []), step.tool])
        }
    }

    return out
}

function ringAround(anchor: GridPosition): GridPosition[] {
    const out: GridPosition[] = []
    for (let col = anchor.col - CONNECTOR_RING; col <= anchor.col + BOX_SPAN - 1 + CONNECTOR_RING; col++) {
        for (let row = anchor.row - CONNECTOR_RING; row <= anchor.row + BOX_SPAN - 1 + CONNECTOR_RING; row++) {
            const cell = { col, row }
            if (blockDistance(anchor, BOX_SPAN, cell) !== CONNECTOR_RING) continue
            if (Math.abs(cellScreenX(cell)) < CENTER_KEEPOUT) continue
            if (Math.abs(cellScreenX(cell)) > CONNECTOR_KEEP_IN.x) continue
            if (Math.abs(cellScreenY(cell)) > CONNECTOR_KEEP_IN.y) continue
            out.push(cell)
        }
    }
    return out
}

const COST_UNDER_TILE = 1000
const COST_BLOCKS_CABLE = 1000
const COST_CROSSES_CABLE = 100
const COST_CROSSES_BEAM = 10

type CableRoute = AxisRoute & { targetId: string }

type Obstacles = {
    tiles: { id: string; position: GridPosition; span: number }[]
    cables: CableRoute[]
    beams: AxisRoute[]
}

const obstaclesBut = (world: Obstacles, ...ids: string[]) =>
    world.tiles.filter(tile => !ids.includes(tile.id)).map(tile => ({ col: tile.position.col, row: tile.position.row, span: tile.span }))

const conflictsOnBoard = (world: Obstacles, connector?: { tile: RoutedTile; agentId: string }) =>
    cableConflicts(
        connector ? [...world.tiles, connector.tile] : world.tiles,
        [
            ...world.cables.map(cable => ({ source: cable.sourceId, target: cable.targetId, variant: 'cable' as const })),
            ...(connector ? [{ source: connector.agentId, target: connector.tile.id, variant: 'cable' as const }] : []),
        ],
    ).length

const routeLength = (points: AxisRoute['points']) =>
    points.slice(1).reduce((total, point, index) => total + Math.abs(point.u - points[index].u) + Math.abs(point.v - points[index].v), 0)

function placementCost(route: AxisRoute, cell: GridPosition, agent: PlacedAgent, world: Obstacles) {
    let cost = 0

    for (const tile of world.tiles) {
        if (tile.id === agent.id) continue
        if (routeHitsBox(route.points, tileAxisBox(tile))) cost += COST_UNDER_TILE
    }

    const candidateBox = tileAxisBox({ position: cell, span: 1 })
    for (const cable of world.cables) {
        if (routeHitsBox(cable.points, candidateBox)) cost += COST_BLOCKS_CABLE
        if (routesCross(route, cable)) cost += COST_CROSSES_CABLE
    }

    for (const beam of world.beams) {
        if (routesCross(route, beam)) cost += COST_CROSSES_BEAM
    }

    return cost
}

function placeConnectors(placed: PlacedBox, tools: Map<string, ConnectorSlug[]>, taken: GridPosition[], world: Obstacles): PlacedConnector[] {
    const ring = ringAround(placed.anchor)
    const out: PlacedConnector[] = []

    for (const agent of placed.agents) {
        for (const slug of tools.get(agent.id) ?? []) {
            const id = connectorId(agent.id, slug)

            const free = ring
                .filter(cell => taken.every(other => chebyshev(other, cell) >= CONNECTOR_SPACING))
                .filter(cell => world.tiles.every(tile => blockDistance(tile.position, tile.span, cell) >= 1))
                .sort((a, b) => {
                    const delta = hashUnit(`${id}@${a.col},${a.row}`, 41) - hashUnit(`${id}@${b.col},${b.row}`, 41)
                    return delta !== 0 ? delta : a.col - b.col || a.row - b.row
                })
            const candidates = free.filter(cell => blockDistance(agent.cell, AGENT_SPAN, cell) <= CONNECTOR_REACH)
            const pool = candidates.length > 0 ? [...candidates, ...free.filter(cell => !candidates.includes(cell))] : ring

            let best: { cell: GridPosition; route: CableRoute; score: number } | null = null
            let conflictsBefore: number | undefined

            for (const cell of pool) {
                const route: CableRoute = {
                    points: routeAlone({ id: agent.id, position: agent.cell, span: AGENT_SPAN }, { id, position: cell, span: 1 }, obstaclesBut(world, agent.id)),
                    sourceId: agent.id,
                    targetId: id,
                }
                let cost = placementCost(route, cell, agent, world)
                if (best !== null && cost * 64 + routeLength(route.points) >= best.score) continue
                const added = conflictsOnBoard(world, { tile: { id, position: cell, span: 1 }, agentId: agent.id }) - (conflictsBefore ??= conflictsOnBoard(world))
                if (added > 0) cost += COST_CROSSES_CABLE * added
                const score = cost * 64 + routeLength(route.points)
                if (best === null || score < best.score) best = { cell, route, score }
                if (cost === 0) break
            }

            if (best === null) continue

            taken.push(best.cell)
            world.tiles.push({ id, position: best.cell, span: 1 })
            world.cables.push(best.route)
            out.push({ id, agentId: agent.id, slug, cell: best.cell })
        }
    }

    return out
}

const AGENT_STEP = 110
const CONNECTOR_GAP = 220
const CONNECTOR_STEP = 80
const CONNECTOR_JITTER = 70
const CABLE_LAG = 380
const STAGE_SETTLE_MS = 900

export function stageLinkId(source: string, target: string) {
    return `${source}->${target}`
}

export type StageStatus = 'working' | 'waiting_human' | 'idle'
export type StageChange = { agent: string; status?: StageStatus; links?: string[] }
export type StageFrame = { at: number; changes: StageChange[] }
export type StageScript = {
    frames: StageFrame[]
    period: number
    startAt: number
}

const space = (id: string, name: string, anchor: GridPosition): SpacePublic => ({
    id,
    workspace_id: 1,
    name,
    col_start: anchor.col,
    row_start: anchor.row,
    col_end: anchor.col + BOX_SPAN - 1,
    row_end: anchor.row + BOX_SPAN - 1,
    created_at: null,
})

export type AuthStage = {
    tiles: Tile[]
    links: TileLink[]
    containers: Container[]
    agentIds: string[]
    dropDelays: Map<string, number>
    appearDelays: Map<string, number>
    script: StageScript
}

function agentBeamPairs(): { source: string; target: string }[] {
    const seen = new Set<string>()
    const out: { source: string; target: string }[] = []

    const add = (source: string, target: string) => {
        if (source === target) return
        const key = stageLinkId(source, target)
        if (seen.has(key)) return
        seen.add(key)
        out.push({ source, target })
    }

    for (const thread of THREADS) {
        thread.steps.forEach((step, index) => {
            if (step.with) add(step.agent, step.with)
            const next = thread.steps[index + 1]
            if (next) add(step.agent, next.agent)
        })
    }

    return out
}

function assertThreadsAreSound(cast: Set<string>) {
    for (const thread of THREADS) {
        for (const step of thread.steps) {
            if (!cast.has(step.agent)) throw new Error(`[auth-stage-board] « ${thread.id} » réveille ${step.agent}, absent du cast`)
            if (!step.with) continue
            if (!cast.has(step.with)) throw new Error(`[auth-stage-board] « ${thread.id} » fait collaborer ${step.agent} avec ${step.with}, absent du cast`)
            if (step.with === step.agent) throw new Error(`[auth-stage-board] « ${thread.id} » fait collaborer ${step.agent} avec lui-même`)
            if (step.hold < COLLAB_MIN_MS)
                throw new Error(`[auth-stage-board] la collaboration ${step.agent} + ${step.with} de « ${thread.id} » ne tient que ${step.hold}ms`)
            if (step.awaitHuman) throw new Error(`[auth-stage-board] la collaboration ${step.agent} + ${step.with} de « ${thread.id} » attend aussi un humain`)
        }
    }
}

type DatedChange = StageChange & { at: number }
type AgentSpan = { thread: string; agent: string; from: number; to: number }

function compileThread(thread: ScriptThread, cableOf: (agent: string, tool: ConnectorSlug) => string | null): { changes: DatedChange[]; spans: AgentSpan[] } {
    const changes: DatedChange[] = []
    const spans: AgentSpan[] = []
    let t = thread.at
    let openedAt = t

    thread.steps.forEach((step, index) => {
        const startedAt = t
        const cable = step.tool ? cableOf(step.agent, step.tool) : null
        const collab = step.with ? stageLinkId(step.agent, step.with) : null
        const lit = [cable, collab].filter((id): id is string => id !== null)
        if (index === 0 || thread.steps[index - 1].agent !== step.agent) openedAt = t

        changes.push({ at: t, agent: step.agent, status: 'working', links: lit })
        if (step.with && collab) changes.push({ at: t, agent: step.with, status: 'working', links: [collab] })
        t += step.hold

        if (step.awaitHuman) {
            changes.push({ at: t, agent: step.agent, status: 'waiting_human', links: [] })
            t += step.awaitHuman
            changes.push({ at: t, agent: step.agent, status: 'working', links: lit })
            t += RESUME_MS
        }

        const next = thread.steps[index + 1]

        if (step.with) {
            if (next?.agent !== step.with) changes.push({ at: t, agent: step.with, status: 'idle', links: [] })
            spans.push({ thread: thread.id, agent: step.with, from: startedAt, to: t })
        }

        if (!next) {
            changes.push({ at: t, agent: step.agent, status: 'idle', links: [] })
            spans.push({ thread: thread.id, agent: step.agent, from: openedAt, to: t })
            return
        }
        if (next.agent === step.agent) return

        changes.push({ at: t, agent: step.agent, status: 'working', links: [stageLinkId(step.agent, next.agent)] })
        changes.push({ at: t + HANDOFF_MS, agent: step.agent, status: 'idle', links: [] })
        spans.push({ thread: thread.id, agent: step.agent, from: openedAt, to: t + HANDOFF_MS })
        t += HANDOFF_LEAD
    })

    return { changes, spans }
}

const SPAN_GAP_MS = 500

const STATUS_CHANGES: DatedChange[] = [
    { at: 2_200, agent: SEO_ANALYST, status: 'working' },
    { at: 12_200, agent: SEO_ANALYST, status: 'waiting_human' },
    { at: 24_200, agent: SEO_ANALYST, status: 'working' },
    { at: 36_200, agent: SEO_ANALYST, status: 'idle' },
    { at: 60_200, agent: SEO_ANALYST, status: 'working' },

    { at: 0, agent: LEAD_SCRAPER, status: 'working' },
    { at: 12_000, agent: LEAD_SCRAPER, status: 'idle' },
    { at: 38_000, agent: LEAD_SCRAPER, status: 'working' },
    { at: 50_000, agent: LEAD_SCRAPER, status: 'idle' },

    { at: 4_800, agent: INBOX_TRIAGE, status: 'working' },
    { at: 16_800, agent: INBOX_TRIAGE, status: 'idle' },
    { at: 37_800, agent: INBOX_TRIAGE, status: 'working' },
    { at: 49_800, agent: INBOX_TRIAGE, status: 'idle' },
    { at: 69_800, agent: INBOX_TRIAGE, status: 'working' },

    { at: 8_000, agent: OUTREACH_WRITER, status: 'working' },
    { at: 20_000, agent: OUTREACH_WRITER, status: 'idle' },
    { at: 32_000, agent: OUTREACH_WRITER, status: 'working' },
    { at: 44_000, agent: OUTREACH_WRITER, status: 'waiting_human' },
    { at: 56_000, agent: OUTREACH_WRITER, status: 'working' },
    { at: 68_000, agent: OUTREACH_WRITER, status: 'idle' },

    { at: 12_000, agent: TICKET_ROUTER, status: 'working' },
    { at: 24_000, agent: TICKET_ROUTER, status: 'idle' },
    { at: 48_000, agent: TICKET_ROUTER, status: 'working' },
    { at: 60_000, agent: TICKET_ROUTER, status: 'idle' },

    { at: 0, agent: INVOICE_CHASER, status: 'idle' },
    { at: 12_000, agent: INVOICE_CHASER, status: 'working' },
    { at: 24_000, agent: INVOICE_CHASER, status: 'idle' },
    { at: 40_000, agent: INVOICE_CHASER, status: 'working' },
    { at: 50_000, agent: INVOICE_CHASER, status: 'waiting_human' },
    { at: 62_000, agent: INVOICE_CHASER, status: 'working' },

    { at: 14_000, agent: CRM_ENRICHER, status: 'working' },
    { at: 26_000, agent: CRM_ENRICHER, status: 'idle' },
    { at: 50_000, agent: CRM_ENRICHER, status: 'working' },
    { at: 62_000, agent: CRM_ENRICHER, status: 'idle' },

    { at: 0, agent: BLOG_WRITER, status: 'idle' },
    { at: 16_000, agent: BLOG_WRITER, status: 'working' },
    { at: 28_000, agent: BLOG_WRITER, status: 'idle' },
    { at: 42_000, agent: BLOG_WRITER, status: 'working' },
    { at: 52_000, agent: BLOG_WRITER, status: 'waiting_human' },
    { at: 62_000, agent: BLOG_WRITER, status: 'working' },

    { at: 18_000, agent: SOCIAL_EDITOR, status: 'working' },
    { at: 30_000, agent: SOCIAL_EDITOR, status: 'idle' },
    { at: 54_000, agent: SOCIAL_EDITOR, status: 'working' },
    { at: 66_000, agent: SOCIAL_EDITOR, status: 'idle' },

    { at: 20_000, agent: MEETING_BOOKER, status: 'working' },
    { at: 34_000, agent: MEETING_BOOKER, status: 'idle' },
    { at: 60_000, agent: MEETING_BOOKER, status: 'working' },
    { at: 70_000, agent: MEETING_BOOKER, status: 'idle' },
]

function assertNoOverlap(spans: AgentSpan[]) {
    const byAgent = new Map<string, AgentSpan[]>()
    for (const span of spans) byAgent.set(span.agent, [...(byAgent.get(span.agent) ?? []), span])

    for (const [agent, own] of byAgent) {
        const sorted = [...own].sort((a, b) => a.from - b.from)
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].from >= sorted[i - 1].to + SPAN_GAP_MS) continue
            throw new Error(`[auth-stage-board] ${agent} est tenu par « ${sorted[i - 1].thread} » et « ${sorted[i].thread} » en même temps`)
        }
    }
}

export function buildAuthStage(): AuthStage {
    const tiles: Tile[] = []
    const links: TileLink[] = []
    const containers: Container[] = []
    const agentIds: string[] = []
    const dropDelays = new Map<string, number>()
    const appearDelays = new Map<string, number>()

    const boxes = BOXES.map(placeBox)
    const allAgents = boxes.flatMap(placed => placed.agents)

    const world: Obstacles = {
        tiles: allAgents.map(agent => ({ id: agent.id, position: agent.cell, span: AGENT_SPAN })),
        cables: [],
        beams: [],
    }

    const cellOf = new Map(allAgents.map(agent => [agent.id, agent.cell]))
    assertThreadsAreSound(new Set(cellOf.keys()))
    const agentBeams = agentBeamPairs()

    for (const beam of agentBeams) {
        world.beams.push({
            points: routeAlone(
                { id: beam.source, position: cellOf.get(beam.source)!, span: AGENT_SPAN },
                { id: beam.target, position: cellOf.get(beam.target)!, span: AGENT_SPAN },
                obstaclesBut(world, beam.source, beam.target),
            ),
            sourceId: beam.source,
        })
    }

    const tools = toolsByAgent()
    const takenCells: GridPosition[] = []
    const connectors = boxes.flatMap(placed => placeConnectors(placed, tools, takenCells, world))
    const connectorWave = allAgents.length * AGENT_STEP + CONNECTOR_GAP
    let connectorIndex = 0

    for (const { box, anchor, agents } of boxes) {
        containers.push(containerFromSpace(space(box.id, box.name, anchor)))

        for (const agent of agents) {
            tiles.push({
                id: agent.id,
                position: agent.cell,
                span: AGENT_SPAN,
                containerId: box.id,
                style: agentTileStyle('idle', agent.name),
                ariaLabel: agent.name,
                selectable: false,
            })
            const drop = agentIds.length * AGENT_STEP
            agentIds.push(agent.id)
            dropDelays.set(agent.id, drop)
        }
    }

    const placedTools = new Set<string>()
    let boardReady = 0

    for (const connector of connectors) {
        const service = CONNECTORS[connector.slug]

        tiles.push({
            id: connector.id,
            position: connector.cell,
            span: 1,
            style: connectorTileStyle(service.icon),
            highlighted: 'highlight' in service && service.highlight === true,
            ariaLabel: service.name,
            selectable: false,
        })

        const drop = Math.round(connectorWave + connectorIndex * CONNECTOR_STEP + (hashUnit(connector.id, 7) - 0.5) * CONNECTOR_JITTER)
        dropDelays.set(connector.id, drop)

        const appear = drop + CABLE_LAG
        links.push({ source: connector.agentId, target: connector.id, variant: 'cable' })
        appearDelays.set(stageLinkId(connector.agentId, connector.id), appear)
        placedTools.add(connector.id)
        boardReady = Math.max(boardReady, appear + CABLE_DRAW_MS)
        connectorIndex++
    }

    for (const connector of connectors) links.push({ source: connector.agentId, target: connector.id, variant: 'beam' })
    for (const beam of agentBeams) links.push({ source: beam.source, target: beam.target, variant: 'beam' })

    const cableOf = (agent: string, tool: ConnectorSlug) => {
        const id = connectorId(agent, tool)
        return placedTools.has(id) ? stageLinkId(agent, id) : null
    }

    const compiled = THREADS.map(thread => compileThread(thread, cableOf))
    assertNoOverlap(compiled.flatMap(thread => thread.spans))

    const linkChanges = compiled.flatMap(thread => thread.changes).map(({ at, agent, links }) => ({ at, agent, links }))
    const frames: StageFrame[] = []
    for (const change of [...linkChanges, ...STATUS_CHANGES].sort((a, b) => a.at - b.at)) {
        const last = frames[frames.length - 1]
        if (last && last.at === change.at) last.changes.push(change)
        else frames.push({ at: change.at, changes: [change] })
    }

    if (process.env.NODE_ENV !== 'production') warnOnCrossings(tiles, links)

    return { tiles, links, containers, agentIds, dropDelays, appearDelays, script: { frames, period: CYCLE_PERIOD, startAt: boardReady + STAGE_SETTLE_MS } }
}

export function cableConflicts(tiles: RoutedTile[], links: RoutedLink[]) {
    const cables = links.filter(link => link.variant === 'cable')
    const routes = routeBoard(tiles, cables)
    const drawn = cables.map(link => ({ id: stageLinkId(link.source, link.target), sourceId: link.source, targetId: link.target, points: routes.get(`${link.source}->${link.target}`) ?? [] }))
    const problems: string[] = []

    for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
            if (routesCross(drawn[i], drawn[j])) problems.push(`${drawn[i].id} x ${drawn[j].id}`)
        }
        for (const tile of tiles) {
            if (tile.id === drawn[i].sourceId || tile.id === drawn[i].targetId) continue
            if (routeHitsBox(drawn[i].points, tileAxisBox(tile))) problems.push(`${drawn[i].id} sous ${tile.id}`)
        }
    }
    return problems
}

function warnOnCrossings(tiles: Tile[], links: TileLink[]) {
    const problems = cableConflicts(tiles, links)

    if (problems.length > 0) console.warn(`[auth-stage-board] ${problems.length} conflits de tracé:`, problems)
}
