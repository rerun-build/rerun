import { SPACE_COLOR, agentTileStyle, connectorTileStyle } from '../iso-grid/presets'
import type { Container, Tile, TileLink } from '../iso-grid/types'
import { GRID_SIZE, TILE_H, TILE_W, hashUnit, isoPosition } from '../iso-grid/iso'

export const TOUR_PHASE_KEYS = ['private-server', 'agents', 'bring-your-own-model', 'connectors', 'team'] as const
export type TourPhaseKey = (typeof TOUR_PHASE_KEYS)[number]

export const LAST_TOUR_PHASE = TOUR_PHASE_KEYS.length - 1

const mark = (file: string) => `/onboarding/tour/board/${file}`

type TourBox = { id: string; name: string; col_start: number; row_start: number; col_end: number; row_end: number }

export const TOUR_BOXES: readonly TourBox[] = [
    { id: 'tour-marketing', name: 'Marketing', col_start: 0, row_start: 0, col_end: 4, row_end: 4 },
    { id: 'tour-sales', name: 'Sales', col_start: 4, row_start: 11, col_end: 8, row_end: 15 },
    { id: 'tour-ops', name: 'Ops', col_start: 11, row_start: 4, col_end: 15, row_end: 8 },
]

type TourAgent = { id: string; name: string; boxId: string; col: number; row: number }

export const TOUR_AGENTS: readonly TourAgent[] = [
    { id: 'tour-watch', name: 'Competitor watch', boxId: 'tour-marketing', col: 0, row: 0 },
    { id: 'tour-writer', name: 'SEO writer', boxId: 'tour-marketing', col: 0, row: 3 },
    { id: 'tour-social', name: 'Social manager', boxId: 'tour-marketing', col: 3, row: 0 },
    { id: 'tour-research', name: 'Lead researcher', boxId: 'tour-sales', col: 7, row: 12 },
    { id: 'tour-desk', name: 'Deal desk', boxId: 'tour-sales', col: 5, row: 14 },
    { id: 'tour-docs', name: 'Doc keeper', boxId: 'tour-ops', col: 12, row: 7 },
    { id: 'tour-invoices', name: 'Invoice chaser', boxId: 'tour-ops', col: 14, row: 5 },
]

type TourConnector = { id: string; name: string; icon: string; agentId: string; additionalAgentIds?: readonly string[]; col: number; row: number; phase: 2 | 3 }

export const TOUR_MODEL_PHASE = 2

export const TOUR_CONNECTORS: readonly TourConnector[] = [
    { id: 'tour-anthropic', name: 'Claude', icon: mark('anthropic.svg'), agentId: 'tour-writer', additionalAgentIds: ['tour-watch'], col: -2, row: 3, phase: 2 },
    { id: 'tour-openai', name: 'ChatGPT', icon: mark('openai.svg?tone=dark'), agentId: 'tour-social', col: 3, row: -2, phase: 2 },
    { id: 'tour-semrush', name: 'Semrush', icon: mark('semrush.svg'), agentId: 'tour-writer', col: 0, row: 6, phase: 3 },
    { id: 'tour-webflow', name: 'Webflow', icon: mark('webflow.svg'), agentId: 'tour-writer', col: 2, row: 6, phase: 3 },
    { id: 'tour-instagram', name: 'Instagram', icon: mark('instagram.svg'), agentId: 'tour-social', col: 6, row: -1, phase: 3 },
    { id: 'tour-tiktok', name: 'TikTok', icon: mark('tiktok.svg?tone=dark'), agentId: 'tour-social', col: 6, row: 1, phase: 3 },
    { id: 'tour-linkedin', name: 'LinkedIn', icon: mark('linkedin.svg'), agentId: 'tour-social', col: 6, row: 3, phase: 3 },
    { id: 'tour-reddit', name: 'Reddit', icon: mark('reddit.svg'), agentId: 'tour-watch', col: 0, row: -2, phase: 3 },
    { id: 'tour-slack', name: 'Slack', icon: mark('slack.svg?v=multicolour'), agentId: 'tour-watch', col: 1, row: -2, phase: 3 },

    { id: 'tour-openrouter', name: 'OpenRouter', icon: mark('openrouter.svg?tone=dark'), agentId: 'tour-desk', col: 10, row: 17, phase: 2 },
    { id: 'tour-grok', name: 'Grok', icon: mark('grok.svg?tone=dark'), agentId: 'tour-invoices', col: 17, row: 8, phase: 2 },
    { id: 'tour-hubspot', name: 'HubSpot', icon: mark('hubspot.svg'), agentId: 'tour-desk', col: 7, row: 17, phase: 3 },
    { id: 'tour-stripe', name: 'Stripe', icon: mark('stripe.svg'), agentId: 'tour-invoices', col: 12, row: 2, phase: 3 },
    { id: 'tour-gmail', name: 'Gmail', icon: mark('gmail.svg'), agentId: 'tour-research', col: 10, row: 11, phase: 3 },
    { id: 'tour-sheets', name: 'Google Sheets', icon: mark('google-sheets.svg'), agentId: 'tour-docs', col: 14, row: 10, phase: 3 },
    { id: 'tour-calendly', name: 'Calendly', icon: mark('calendly.svg'), agentId: 'tour-research', col: 5, row: 9, phase: 3 },
    { id: 'tour-notion', name: 'Notion', icon: mark('notion.svg?tone=dark'), agentId: 'tour-docs', col: 9, row: 7, phase: 3 },
]

export const TOUR_HANDOFFS: readonly { id: string; source: string; target: string }[] = [
    { id: 'handoff-marketing-sales', source: 'tour-social', target: 'tour-desk' },
    { id: 'handoff-marketing-ops', source: 'tour-writer', target: 'tour-invoices' },
]

export const TOUR_AGENT_IDS = TOUR_AGENTS.map(agent => agent.id)

export const TOUR_AGENTS_PHASE = 1

export const FOCUS_BOX_ID = 'tour-marketing'
const FOCUS_AGENTS = TOUR_AGENTS.filter(agent => agent.boxId === FOCUS_BOX_ID)
export const FOCUS_TILE_IDS: ReadonlySet<string> = new Set([...FOCUS_AGENTS.map(agent => agent.id), ...TOUR_CONNECTORS.filter(connector => FOCUS_AGENTS.some(agent => agent.id === connector.agentId)).map(connector => connector.id)])

export function linkId(source: string, target: string) {
    return `${source}->${target}`
}

const BOX_STEP = 620
const BOX_DRAW_MS = 900
const AGENT_LEAD = 260
const AGENT_STEP = 190
const CONNECTOR_GAP = 220
const CONNECTOR_STEP = 90
const CONNECTOR_JITTER = 70
const CABLE_LAG = 380
export const TOUR_CAMERA_SETTLE = 520

function jitter(id: string) {
    return Math.round((hashUnit(id, 7) - 0.5) * CONNECTOR_JITTER)
}

export type TourBoard = {
    containers: Container[]
    tiles: Tile[]
    links: TileLink[]
}

export type TourBoardOptions = { animatedPhase: number | null; lit?: boolean; focused?: boolean; livePhase?: number }

function containerFor(box: TourBox, index: number, animated: boolean, dimmed: boolean): Container {
    return {
        id: box.id,
        dimmed,
        label: box.name,
        color: SPACE_COLOR,
        col_start: box.col_start,
        row_start: box.row_start,
        col_end: box.col_end,
        row_end: box.row_end,
        ariaLabel: `Box: ${box.name}`,
        justPlaced: animated,
        dropDelay: animated ? index * BOX_STEP : undefined,
        dropStyle: animated ? 'draw' : undefined,
        dropDuration: animated ? BOX_DRAW_MS : undefined,
    }
}

function agentTile(agent: TourAgent, delay: number | null, dimmed: boolean): Tile {
    return {
        id: agent.id,
        dimmed,
        position: { col: agent.col, row: agent.row },
        span: 2,
        containerId: agent.boxId,
        style: agentTileStyle('idle', agent.name),
        selectable: false,
        draggable: false,
        justPlaced: delay !== null,
        dropDelay: delay ?? undefined,
        ariaLabel: agent.name,
    }
}

function connectorTile(connector: TourConnector, delay: number | null, lit: boolean, dimmed: boolean): Tile {
    return {
        id: connector.id,
        dimmed,
        position: { col: connector.col, row: connector.row },
        span: 1,
        style: connectorTileStyle(connector.icon),
        highlighted: lit && connector.phase === TOUR_MODEL_PHASE,
        selectable: false,
        draggable: false,
        justPlaced: delay !== null,
        dropDelay: delay ?? undefined,
        ariaLabel: connector.name,
    }
}

export function boardForPhase(phase: number, { animatedPhase, lit = false, focused = false, livePhase }: TourBoardOptions = { animatedPhase: null }): TourBoard {
    const current = Math.min(Math.max(phase, 0), LAST_TOUR_PHASE)
    const live = Math.min(livePhase ?? current, current)
    const dimmed = (tileId: string, tilePhase: number) => (focused && !FOCUS_TILE_IDS.has(tileId)) || tilePhase > live
    const containers = TOUR_BOXES.map((box, index) => containerFor(box, index, animatedPhase === 0, focused && box.id !== FOCUS_BOX_ID))

    const tiles: Tile[] = []
    const links: TileLink[] = []
    if (current === 0) return { containers, tiles, links }

    const settle = animatedPhase !== null && isTourFocusPhase(animatedPhase) ? TOUR_CAMERA_SETTLE : 0

    const agentsAnimated = animatedPhase === TOUR_AGENTS_PHASE
    TOUR_AGENTS.forEach((agent, index) => {
        tiles.push(agentTile(agent, agentsAnimated ? AGENT_LEAD + index * AGENT_STEP : null, dimmed(agent.id, TOUR_AGENTS_PHASE)))
    })

    const waveStart = settle + CONNECTOR_GAP
    let landed = 0

    for (const connector of TOUR_CONNECTORS) {
        if (connector.phase > current) continue
        const faded = dimmed(connector.id, connector.phase)
        const animated = animatedPhase === connector.phase && !faded
        const delay = animated ? waveStart + landed * CONNECTOR_STEP + jitter(connector.id) : null
        if (animated) landed++

        tiles.push(connectorTile(connector, delay, lit, faded))
        for (const agentId of [connector.agentId, ...(connector.additionalAgentIds ?? [])]) {
            links.push({
                source: agentId,
                target: connector.id,
                variant: connector.phase === TOUR_MODEL_PHASE ? 'beam' : 'cable',
                appearDelay: delay === null ? undefined : delay + CABLE_LAG,
            })
        }
    }

    return { containers, tiles, links }
}

const CENTER_ISO = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)

const FOCUS_PHASE = TOUR_PHASE_KEYS.indexOf('connectors')

export function isTourFocusPhase(phase: number) {
    return phase === FOCUS_PHASE
}

const WIDE = { insetX: 0.97, insetY: 0.97, maxZoom: 1.6, sky: null }
const FOCUS = { insetX: 0.88, insetY: 0.9, maxZoom: 2.6, sky: null }
const MIN_ZOOM = 0.3

type Bounds = { left: number; right: number; top: number; bottom: number }
type Footprint = { col: number; row: number; span: number }

function boundsOf(boxes: readonly TourBox[], footprints: readonly Footprint[]): Bounds {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity

    const grow = (x: number, y: number, width: number, height: number) => {
        left = Math.min(left, x)
        right = Math.max(right, x + width)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y + height)
    }

    for (const box of boxes) {
        for (const [col, row] of [
            [box.col_start, box.row_start],
            [box.col_end + 1, box.row_start],
            [box.col_end + 1, box.row_end + 1],
            [box.col_start, box.row_end + 1],
        ]) {
            const { left: isoLeft, top: isoTop } = isoPosition(col, row)
            grow(isoLeft + TILE_W / 2 - CENTER_ISO.left, isoTop - CENTER_ISO.top, 0, 0)
        }
    }

    for (const { col, row, span } of footprints) {
        const { left: isoLeft, top: isoTop } = isoPosition(col, row)
        grow(isoLeft - ((span - 1) * TILE_W) / 2 - CENTER_ISO.left, isoTop - CENTER_ISO.top, span * TILE_W, span * TILE_H)
    }

    return { left, right, top, bottom }
}

const AGENT_SPAN = 2
const CONNECTOR_SPAN = 1

const AGENT_FOOTPRINTS = TOUR_AGENTS.map(agent => ({ col: agent.col, row: agent.row, span: AGENT_SPAN }))

export const TOUR_STAGE_BOUNDS = boundsOf(TOUR_BOXES, [...AGENT_FOOTPRINTS, ...TOUR_CONNECTORS.map(connector => ({ col: connector.col, row: connector.row, span: CONNECTOR_SPAN }))])

const UNWIRED_STAGE_BOUNDS = boundsOf(TOUR_BOXES, AGENT_FOOTPRINTS)

function focusBounds(): Bounds {
    const box = TOUR_BOXES.find(b => b.id === FOCUS_BOX_ID)
    if (!box) return TOUR_STAGE_BOUNDS
    return boundsOf([box], [...FOCUS_AGENTS.map(agent => ({ col: agent.col, row: agent.row, span: AGENT_SPAN })), ...TOUR_CONNECTORS.filter(connector => FOCUS_TILE_IDS.has(connector.id)).map(connector => ({ col: connector.col, row: connector.row, span: CONNECTOR_SPAN }))])
}

const FOCUS_BOUNDS = focusBounds()

type Shot = { insetX: number; insetY: number; maxZoom: number; sky: number | null }

function frameBounds(bounds: Bounds, frame: { width: number; height: number }, { insetX, insetY, maxZoom, sky }: Shot) {
    const width = bounds.right - bounds.left
    const height = bounds.bottom - bounds.top
    const fit = Math.min((frame.width * insetX) / width, (frame.height * insetY) / height)
    const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, fit))
    const half = frame.height / (2 * zoom)
    const overhead = sky === null ? 0 : Math.min(half * 2 - height, height * sky)
    return {
        zoom,
        pan: {
            x: -(bounds.left + bounds.right) / 2,
            y: sky === null ? -(bounds.top + bounds.bottom) / 2 : overhead - bounds.top - half,
        },
    }
}

export function frameTourStage(frame: { width: number; height: number }, { connectors = true }: { connectors?: boolean } = {}) {
    return frameBounds(connectors ? TOUR_STAGE_BOUNDS : UNWIRED_STAGE_BOUNDS, frame, WIDE)
}

export function frameTourPhase(phase: number, frame: { width: number; height: number }) {
    return isTourFocusPhase(phase) ? frameBounds(FOCUS_BOUNDS, frame, FOCUS) : frameTourStage(frame)
}

export function tourAgentWorldCenter(agentId: string) {
    const agent = TOUR_AGENTS.find(a => a.id === agentId)
    if (!agent) return { x: 0, y: 0 }
    const { left, top } = isoPosition(agent.col, agent.row)
    return { x: left - CENTER_ISO.left + TILE_W / 2, y: top - CENTER_ISO.top + TILE_H }
}
