import { CONTAINER_SIDES, GRID_SIZE, hashUnit, isoPosition, TILE_H, TILE_W } from '@rerun/ui/iso-grid/iso'
import type { IsoCamera } from '@rerun/ui/iso-grid'

import type { AgentLink, AgentStatus, IsoAgent, SpacePublic } from '@/lib/board/types'
import { findFreeRect, rectOnSide, type NewSpaceRect, type SpaceRect } from '@/lib/board/space-layout'
import { CARD_THEMES, type CardTheme } from '@/lib/og/size'
import { randomUuid } from '@/lib/random-uuid'

export type SceneOptions = {
    boxes?: number
    agentsPerBox?: number
    theme?: CardTheme
}

export type WorkspaceScene = {
    seed: string
    width: number
    height: number
    theme: CardTheme
    spaces: SpacePublic[]
    agents: IsoAgent[]
    links: AgentLink[]
    camera: IsoCamera
}

export const MAX_SCENE_BOXES = 4
export const MIN_AGENTS_PER_BOX = 2
export const MAX_AGENTS_PER_BOX = 6
const RANDOM_MIN_AGENTS = 3

const BOX_COUNT_WEIGHTS: readonly [number, number][] = [
    [1, 0.55],
    [2, 0.25],
    [3, 0.15],
    [4, 0.05],
]

const STATUS_WEIGHTS: readonly [AgentStatus, number][] = [
    ['idle', 0.56],
    ['working', 0.3],
    ['waiting_human', 0.14],
]

const BOX_NAMES = ['Marketing', 'Sales', 'Ops', 'Support', 'Growth', 'Finance', 'Content', 'Product', 'Data', 'Engineering', 'Recruiting', 'Community']

const AGENT_NAMES = [
    'SEO writer',
    'Competitor watch',
    'Social manager',
    'Lead researcher',
    'Deal desk',
    'Doc keeper',
    'Invoice chaser',
    'Inbox triage',
    'Changelog writer',
    'Meeting notes',
    'Churn watch',
    'Bug triage',
    'Weekly report',
    'Ad copy',
    'Onboarding buddy',
    'Refund handler',
    'Standup digest',
    'Lead enricher',
    'Review replier',
    'Newsletter',
    'Site watcher',
    'Contract reader',
    'Expense sorter',
    'Roadmap keeper',
]

const MIN_WIDTH = 1283
const WIDTH_STEPS = 58
const HEIGHT_JITTER = 32

const ZOOM_CEILING: Record<number, number> = { 1: 2.3, 2: 1.7, 3: 1.35, 4: 1.15 }

const CENTER_ISO = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)
const WORLD_OFFSET = { left: -CENTER_ISO.left, top: -CENTER_ISO.top }
const FIT_PADDING = TILE_W / 2
const AGENT_SPAN = 2

const SLOT_OFFSETS = [0, 3, 6]
const MAX_TILES_PER_SCREEN_COLUMN = 2

type Rng = () => number

function makeRng(seed: string): Rng {
    let salt = 0
    return () => hashUnit(seed, salt++)
}

function pick<T>(rng: Rng, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)]
}

function pickInt(rng: Rng, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1))
}

function pickWeighted<T>(rng: Rng, weights: readonly (readonly [T, number])[]): T {
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
    let ticket = rng() * total
    for (const [value, weight] of weights) {
        ticket -= weight
        if (ticket <= 0) return value
    }
    return weights[weights.length - 1][0]
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function toSpaceRect(rect: NewSpaceRect): SpaceRect {
    return { col_start: rect.colStart, row_start: rect.rowStart, col_end: rect.colEnd, row_end: rect.rowEnd }
}

function layoutBoxes(rng: Rng, count: number): SpaceRect[] {
    const rects: SpaceRect[] = [toSpaceRect(findFreeRect([]))]
    while (rects.length < count) {
        const source = pick(rng, rects)
        const side = pick(rng, CONTAINER_SIDES)
        rects.push(toSpaceRect(rectOnSide(source, side, rects)))
    }
    return rects
}

function agentSlots(rng: Rng, rect: SpaceRect, count: number): { col: number; row: number }[] {
    const all = SLOT_OFFSETS.flatMap(dc => SLOT_OFFSETS.map(dr => ({ col: rect.col_start + dc, row: rect.row_start + dr })))
    const taken: { col: number; row: number }[] = []
    const perScreenColumn = new Map<number, number>()
    for (const slot of shuffle(rng, all)) {
        if (taken.length === count) break
        const screenColumn = slot.col - slot.row
        const used = perScreenColumn.get(screenColumn) ?? 0
        if (used >= MAX_TILES_PER_SCREEN_COLUMN) continue
        perScreenColumn.set(screenColumn, used + 1)
        taken.push(slot)
    }
    return taken
}

type WorldBox = { left: number; right: number; top: number; bottom: number }

function tileBox(col: number, row: number, span: number) {
    const p = isoPosition(col, row)
    return { left: p.left - TILE_W / 2 + WORLD_OFFSET.left, top: p.top + WORLD_OFFSET.top, width: span * TILE_W, height: span * TILE_H }
}

function contentWorldBox(spaces: SpacePublic[], agents: IsoAgent[]): WorldBox | null {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    const acc = (col: number, row: number, span: number) => {
        const b = tileBox(col, row, span)
        left = Math.min(left, b.left)
        right = Math.max(right, b.left + b.width)
        top = Math.min(top, b.top)
        bottom = Math.max(bottom, b.top + b.height)
    }
    for (const agent of agents) acc(agent.position.col, agent.position.row, AGENT_SPAN)
    for (const space of spaces) {
        acc(space.col_start, space.row_start, 1)
        acc(space.col_end, space.row_start, 1)
        acc(space.col_start, space.row_end, 1)
        acc(space.col_end, space.row_end, 1)
    }
    return Number.isFinite(left) ? { left, right, top, bottom } : null
}

function frameScene(spaces: SpacePublic[], agents: IsoAgent[], frame: { width: number; height: number }, maxZoom: number): IsoCamera {
    const box = contentWorldBox(spaces, agents)
    if (!box) return { pan: { x: 0, y: 0 }, zoom: maxZoom }
    const fit = Math.min(frame.width / (box.right - box.left + FIT_PADDING * 2), frame.height / (box.bottom - box.top + FIT_PADDING * 2))
    return {
        zoom: Math.min(maxZoom, Math.max(0.3, fit)),
        pan: { x: -(box.left + box.right) / 2, y: -(box.top + box.bottom) / 2 },
    }
}

export function randomSeed(): string {
    return randomUuid().slice(0, 8)
}

export function buildWorkspaceScene(seed: string, options: SceneOptions = {}): WorkspaceScene {
    const rng = makeRng(seed)

    const width = MIN_WIDTH + Math.round(rng() * WIDTH_STEPS) * 8
    const height = Math.round((width * 9) / 16) + Math.round((rng() - 0.5) * HEIGHT_JITTER)
    const theme = options.theme ?? pick(rng, CARD_THEMES)

    const boxCount = clamp(options.boxes ?? pickWeighted(rng, BOX_COUNT_WEIGHTS), 1, MAX_SCENE_BOXES)
    const rects = layoutBoxes(rng, boxCount)
    const boxNames = shuffle(rng, BOX_NAMES)
    const agentNames = shuffle(rng, AGENT_NAMES)

    const spaces: SpacePublic[] = rects.map((rect, index) => ({
        id: `${seed}-space-${index}`,
        workspace_id: 1,
        name: boxNames[index % boxNames.length],
        col_start: rect.col_start,
        row_start: rect.row_start,
        col_end: rect.col_end,
        row_end: rect.row_end,
        created_at: '2026-01-01T00:00:00.000Z',
    }))

    const agents: IsoAgent[] = []
    for (const [index, space] of spaces.entries()) {
        const count = clamp(options.agentsPerBox ?? pickInt(rng, RANDOM_MIN_AGENTS, MAX_AGENTS_PER_BOX), 1, SLOT_OFFSETS.length ** 2)
        for (const slot of agentSlots(rng, rects[index], count)) {
            const name = agentNames[agents.length % agentNames.length]
            agents.push({
                id: `${seed}-agent-${agents.length}`,
                name,
                handle: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                description: null,
                templateId: null,
                status: pickWeighted(rng, STATUS_WEIGHTS),
                position: slot,
                workspaceId: 1,
                spaceId: space.id,
                disabledAt: null,
                disabledReason: null,
            })
        }
    }

    if (agents.length > 0 && !agents.some(a => a.status === 'working')) {
        agents[Math.floor(rng() * agents.length)].status = 'working'
    }

    const links: AgentLink[] = []
    for (const source of agents) {
        if (links.length >= 3) break
        if (source.status !== 'working' || rng() > 0.7) continue
        const sameBox = agents.filter(a => a.id !== source.id && a.spaceId === source.spaceId)
        const candidates = sameBox.length > 0 ? sameBox : agents.filter(a => a.id !== source.id)
        if (candidates.length === 0) continue
        const target = candidates[Math.floor(rng() * candidates.length)]
        if (links.some(l => l.source === source.id && l.target === target.id)) continue
        links.push({ source: source.id, target: target.id })
    }

    const ceiling = ZOOM_CEILING[boxCount] ?? 1.15
    const camera = frameScene(spaces, agents, { width, height }, ceiling * (0.9 + rng() * 0.2))

    return { seed, width, height, theme, spaces, agents, links, camera }
}
