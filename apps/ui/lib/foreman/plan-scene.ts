import { SPACE_COLOR, agentTileStyle, type Container, type GridPosition, type Tile } from '@rerun/ui/iso-grid'

import type { PlanGroup, ShownPlan } from '@/components/foreman/widgets/plan-card'
import { AGENT_SPAN } from '@/lib/board/iso'
import { findRadialRect, type NewSpaceRect, type SpaceRect } from '@/lib/board/space-layout'

export type PlanScene = {
    containers: Container[]
    tiles: Tile[]
    landedAt: number
}

export type PlanSceneOptions = {
    animated?: boolean
    built?: SpaceRect[]
}

const BOX_DRAW_MS = 900
const BOX_STEP = 420
const AGENT_LAG = BOX_DRAW_MS * 0.55
const AGENT_STEP = 120
const TILE_DROP_MS = 1000

const PREVIEW_TILE_OPACITY = 0.5

export const PLAN_PREVIEW_PREFIX = 'plan-preview:'

export function isPlanPreviewId(id: string | null | undefined): boolean {
    return !!id?.startsWith(PLAN_PREVIEW_PREFIX)
}

function toSpaceRect(rect: NewSpaceRect): SpaceRect {
    return { col_start: rect.colStart, row_start: rect.rowStart, col_end: rect.colEnd, row_end: rect.rowEnd }
}

function sameRect(a: SpaceRect, b: SpaceRect): boolean {
    const bounds = (rect: SpaceRect) => [Math.min(rect.col_start, rect.col_end), Math.max(rect.col_start, rect.col_end), Math.min(rect.row_start, rect.row_end), Math.max(rect.row_start, rect.row_end)]
    const left = bounds(a)
    const right = bounds(b)
    return left.every((value, index) => value === right[index])
}

const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function uniqueKey(base: string, taken: Set<string>): string {
    let key = base
    for (let index = 2; taken.has(key); index++) key = `${base}-${index}`
    taken.add(key)
    return key
}

function anchorsIn(rect: NewSpaceRect, count: number): GridPosition[] {
    const anchors: GridPosition[] = []
    for (let row = rect.rowStart; row + AGENT_SPAN - 1 <= rect.rowEnd; row += AGENT_SPAN) {
        for (let col = rect.colStart; col + AGENT_SPAN - 1 <= rect.colEnd; col += AGENT_SPAN) {
            if (anchors.length === count) return anchors
            anchors.push({ col, row })
        }
    }
    return anchors
}

export function planScene(plan: ShownPlan, { animated = true, built = [] }: PlanSceneOptions = {}): PlanScene {
    const containers: Container[] = []
    const tiles: Tile[] = []
    const placed: SpaceRect[] = []
    const boxKeys = new Set<string>()
    let landedAt = 0

    for (const group of plan.groups) {
        const rect = findRadialRect(placed)
        placed.push(toSpaceRect(rect))

        const boxKey = uniqueKey(slugOf(group.name ?? '') || 'box', boxKeys)
        const boxId = `${PLAN_PREVIEW_PREFIX}${boxKey}`
        if (built.some(existing => sameRect(existing, toSpaceRect(rect)))) continue

        const boxDelay = containers.length * BOX_STEP
        containers.push({
            id: boxId,
            label: group.name,
            color: SPACE_COLOR,
            col_start: rect.colStart,
            row_start: rect.rowStart,
            col_end: rect.colEnd,
            row_end: rect.rowEnd,
            ariaLabel: group.name ? `${group.name}, planned` : 'Planned Box',
            ...(animated ? { justPlaced: true, dropStyle: 'draw' as const, dropDuration: BOX_DRAW_MS, dropDelay: boxDelay } : {}),
        })
        landedAt = Math.max(landedAt, boxDelay + BOX_DRAW_MS)

        const agentKeys = new Set<string>()
        anchorsIn(rect, group.items.length).forEach((position, rank) => {
            const item = group.items[rank]
            const dropDelay = boxDelay + AGENT_LAG + rank * AGENT_STEP
            tiles.push({
                id: `${boxId}/${uniqueKey(slugOf(item.name) || 'agent', agentKeys)}`,
                position,
                span: AGENT_SPAN,
                containerId: boxId,
                style: agentTileStyle('idle', item.name),
                selectable: false,
                draggable: false,
                ariaLabel: `${item.name}, planned`,
                ...(animated ? { justPlaced: true, dropDelay } : {}),
            })
            landedAt = Math.max(landedAt, dropDelay + TILE_DROP_MS)
        })
    }

    return { containers, tiles, landedAt: animated ? landedAt : 0 }
}

export function settledPlanScene(scene: PlanScene): PlanScene {
    return {
        ...scene,
        containers: scene.containers.map(container => ({ ...container, ghost: true })),
        tiles: scene.tiles.map(tile => ({ ...tile, style: { ...tile.style, opacity: PREVIEW_TILE_OPACITY, sheen: false, stripes: true } })),
    }
}

const CARD_BOX_MARGIN = 1
const CARD_AGENT_GAP = 1
const CARD_BOX_ID = 'plan-card:box'

export function planCardScene(group: PlanGroup, { animated = true }: { animated?: boolean } = {}): Pick<PlanScene, 'containers' | 'tiles'> {
    const slots = Math.max(1, group.items.length)

    return {
        containers: [
            {
                id: CARD_BOX_ID,
                label: group.name,
                color: SPACE_COLOR,
                col_start: 0,
                row_start: 0,
                col_end: CARD_BOX_MARGIN * 2 + slots * AGENT_SPAN + (slots - 1) * CARD_AGENT_GAP - 1,
                row_end: CARD_BOX_MARGIN * 2 + AGENT_SPAN - 1,
                ghost: group.items.length === 0,
                ariaLabel: group.name ? `${group.name}, planned` : 'Planned Box',
                ...(animated ? { justPlaced: true, dropStyle: 'draw' as const, dropDuration: BOX_DRAW_MS } : {}),
            },
        ],
        tiles: group.items.map((item, rank) => ({
            id: `${CARD_BOX_ID}/${rank}`,
            position: { col: CARD_BOX_MARGIN + rank * (AGENT_SPAN + CARD_AGENT_GAP), row: CARD_BOX_MARGIN },
            span: AGENT_SPAN,
            containerId: CARD_BOX_ID,
            style: agentTileStyle('idle', item.name),
            selectable: false,
            draggable: false,
            ariaLabel: `${item.name}, planned`,
            ...(animated ? { justPlaced: true, dropDelay: AGENT_LAG + rank * AGENT_STEP } : {}),
        })),
    }
}
