import type { TemplateAgent, TemplateConnector } from '@rerun/contracts'

import { CABLE_DRAW_MS } from './components/TileLinks'
import { BLOCK_HEIGHT, GRID_SIZE, TILE_H, TILE_W, hashUnit, isoPosition, tileTopLift } from './iso'
import { type AgentStatus, agentTileStyle, connectorTileStyle } from './presets'
import type { Tile, TileLink } from './types'

const AGENT_SLOTS = [
    { col: 5, row: 5 },
    { col: 9, row: 5 },
    { col: 5, row: 9 },
    { col: 9, row: 9 },
    { col: 1, row: 5 },
    { col: 5, row: 1 },
    { col: 13, row: 9 },
    { col: 9, row: 13 },
]

const CONNECTOR_RING = [
    { col: -2, row: 0 },
    { col: 3, row: 1 },
    { col: 0, row: -2 },
    { col: 1, row: 3 },
    { col: -2, row: 2 },
    { col: 3, row: -1 },
    { col: -2, row: -2 },
    { col: 3, row: 3 },
    { col: 2, row: -2 },
    { col: -1, row: 3 },
]

function connectorBudget(agentCount: number) {
    return agentCount === 1 ? CONNECTOR_RING.length : 3
}

export type BoardFrame = { width: number; height: number }

const FIT_INSET = 0.92

const CENTER_ISO = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)

function agentSlot(index: number) {
    const slot = AGENT_SLOTS[index]
    if (slot) return slot
    const overflow = index - AGENT_SLOTS.length
    return { col: 13 + overflow * 4, row: 13 + overflow * 4 }
}

function cellKey(col: number, row: number) {
    return `${col},${row}`
}

type Cell = { col: number; row: number }

function agentCenter(anchor: Cell) {
    const { left, top } = isoPosition(anchor.col, anchor.row)
    return { x: left + TILE_W / 2, y: top + TILE_H }
}

function offsetDirection(offset: Cell) {
    const x = (offset.col - offset.row) * (TILE_W / 2)
    const y = (offset.col + offset.row) * (TILE_H / 2) - TILE_H / 2
    const length = Math.hypot(x, y)
    return { x: x / length, y: y / length }
}

function ringFor(anchor: Cell, boardCenter: { x: number; y: number }) {
    const center = agentCenter(anchor)
    const outward = { x: center.x - boardCenter.x, y: center.y - boardCenter.y }
    const score = (offset: Cell) => {
        const direction = offsetDirection(offset)
        return direction.x * outward.x + direction.y * outward.y
    }
    return [...CONNECTOR_RING].sort((a, b) => score(b) - score(a))
}

function touches(cells: Set<string>, position: Cell) {
    for (let col = position.col - 1; col <= position.col + 1; col++) {
        for (let row = position.row - 1; row <= position.row + 1; row++) {
            if (cells.has(cellKey(col, row))) return true
        }
    }
    return false
}

function pickCell(ring: Cell[], anchor: Cell, keepOut: Set<string>, connectorCells: Set<string>, spaced: boolean) {
    for (const offset of ring) {
        const position = { col: anchor.col + offset.col, row: anchor.row + offset.row }
        if (keepOut.has(cellKey(position.col, position.row))) continue
        if (spaced ? touches(connectorCells, position) : connectorCells.has(cellKey(position.col, position.row))) continue
        return position
    }
    return null
}

export type BoardAgent = Pick<TemplateAgent, 'key' | 'name' | 'connectorSlugs'> & { status?: AgentStatus }

export function templateLinkId(source: string, target: string) {
    return `${source}->${target}`
}

const AGENT_STEP = 110
const CONNECTOR_GAP = 220
const CONNECTOR_STEP = 80
const CONNECTOR_JITTER = 70
const CABLE_LAG = 380

export function buildTemplateBoard(agents: BoardAgent[], connectors: TemplateConnector[], highlightedSlugs: ReadonlySet<string>) {
    const bySlug = new Map(connectors.map(connector => [connector.slug, connector]))
    const anchors = agents.map((_, index) => agentSlot(index))
    const tiles: Tile[] = []
    const links: TileLink[] = []
    const linkIdsByAgent = new Map<string, string[]>()
    const dropDelays = new Map<string, number>()
    const appearDelays = new Map<string, number>()
    const wakeDelays = new Map<string, number>()

    const keepOut = new Set<string>()
    for (const anchor of anchors) {
        for (let col = anchor.col - 1; col <= anchor.col + 2; col++) {
            for (let row = anchor.row - 1; row <= anchor.row + 2; row++) keepOut.add(cellKey(col, row))
        }
    }

    agents.forEach((agent, index) => {
        tiles.push({
            id: agent.key,
            position: anchors[index],
            span: 2,
            style: agentTileStyle(agent.status ?? 'idle', agent.name),
            ariaLabel: agent.name,
        })
        dropDelays.set(agent.key, index * AGENT_STEP)
        wakeDelays.set(agent.key, index * AGENT_STEP)
    })

    const budget = connectorBudget(agents.length)
    const boardCenter = {
        x: anchors.reduce((sum, anchor) => sum + agentCenter(anchor).x, 0) / anchors.length,
        y: anchors.reduce((sum, anchor) => sum + agentCenter(anchor).y, 0) / anchors.length,
    }
    const connectorCells = new Set<string>()
    const connectorWave = agents.length * AGENT_STEP + CONNECTOR_GAP
    let connectorIndex = 0

    agents.forEach((agent, index) => {
        const anchor = anchors[index]
        const ring = ringFor(anchor, boardCenter)
        let placed = 0

        for (const slug of agent.connectorSlugs) {
            if (placed >= budget) break
            const connector = bySlug.get(slug)
            if (!connector) continue

            const position = pickCell(ring, anchor, keepOut, connectorCells, true) ?? pickCell(ring, anchor, keepOut, connectorCells, false)
            if (!position) break

            connectorCells.add(cellKey(position.col, position.row))
            const id = `${agent.key}::${slug}`

            tiles.push({
                id,
                position,
                span: 1,
                style: connectorTileStyle(connector.icon),
                highlighted: highlightedSlugs.has(slug),
                ariaLabel: connector.name,
            })
            const dropDelay = connectorWave + connectorIndex * CONNECTOR_STEP + (hashUnit(id, 7) - 0.5) * CONNECTOR_JITTER
            dropDelays.set(id, Math.round(dropDelay))
            const appearDelay = Math.round(dropDelay + CABLE_LAG)
            appearDelays.set(templateLinkId(agent.key, id), appearDelay)
            wakeDelays.set(agent.key, Math.max(wakeDelays.get(agent.key) ?? 0, appearDelay + CABLE_DRAW_MS))
            connectorIndex++

            links.push({ source: agent.key, target: id, variant: 'cable' })
            linkIdsByAgent.set(agent.key, [...(linkIdsByAgent.get(agent.key) ?? []), templateLinkId(agent.key, id)])
            placed++
        }
    })

    return { tiles, links, agentKeys: agents.map(agent => agent.key), agentCount: agents.length, linkIdsByAgent, dropDelays, appearDelays, wakeDelays }
}

export function frameTemplateBoard(tiles: Tile[], frame: BoardFrame, maxZoom: number, inset = FIT_INSET, minZoom = 0.3) {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity

    for (const tile of tiles) {
        const span = tile.span ?? 2
        const { left: isoLeft, top: isoTop } = isoPosition(tile.position.col, tile.position.row)
        const tileLeft = isoLeft - ((span - 1) * TILE_W) / 2
        left = Math.min(left, tileLeft - CENTER_ISO.left)
        right = Math.max(right, tileLeft + span * TILE_W - CENTER_ISO.left)
        top = Math.min(top, isoTop - tileTopLift(tile.style, span) - CENTER_ISO.top)
        bottom = Math.max(bottom, isoTop + span * TILE_H - CENTER_ISO.top)
    }

    const fit = Math.min((frame.width * inset) / (right - left), (frame.height * inset) / (bottom - top))
    return { zoom: Math.min(maxZoom, Math.max(minZoom, fit)), pan: { x: -(left + right) / 2, y: -(top + bottom) / 2 } }
}


export function tileWorldRise(tile: Tile) {
    return tileTopLift(tile.style, tile.span ?? 2) - BLOCK_HEIGHT
}

export function tileWorldCenter(tile: Tile) {
    const span = tile.span ?? 2
    const { left, top } = isoPosition(tile.position.col, tile.position.row)
    return { x: left - CENTER_ISO.left + TILE_W / 2, y: top - CENTER_ISO.top + (span * TILE_H) / 2 }
}
