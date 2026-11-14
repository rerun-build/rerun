import type { TemplateStoryArtifact, TemplateStoryStep } from '@rerun/contracts'

import { agentTileStyle } from '../iso-grid/presets'
import { type buildTemplateBoard, templateLinkId } from '../iso-grid/template-board-geometry'
import type { Tile, TileLink } from '../iso-grid/types'

export type StoryBoard = ReturnType<typeof buildTemplateBoard>

export type StagedStoryStep = TemplateStoryStep & { toolTileId: string | null; handoffTileId: string | null }

export function stageStory(steps: readonly TemplateStoryStep[], board: StoryBoard): StagedStoryStep[] {
    const tileIds = new Set(board.tiles.map(tile => tile.id))
    const agentKeys = new Set(board.agentKeys)
    return steps
        .filter(step => agentKeys.has(step.agentKey))
        .map(step => {
            const toolTileId = step.toolSlug ? `${step.agentKey}::${step.toolSlug}` : null
            const handoffTileId = step.handoffTo && step.handoffTo !== step.agentKey && agentKeys.has(step.handoffTo) ? step.handoffTo : null
            return { ...step, toolTileId: toolTileId && tileIds.has(toolTileId) ? toolTileId : null, handoffTileId }
        })
}

export type StoryFrame = {
    tiles: Tile[]
    links: TileLink[]
    focusTileIds: string[]
    artifact: { stepId: string; anchorTileId: string; actions: readonly string[]; result: TemplateStoryArtifact | null; toolSlug: string | null } | null
}

export function storyFrame(step: StagedStoryStep | null, board: StoryBoard, { entrance }: { entrance: boolean }): StoryFrame {
    const involved = new Set(step ? [step.agentKey, step.toolTileId, step.handoffTileId].filter((id): id is string => id !== null) : [])
    const dimOthers = step !== null && step.camera === 'agent'

    const tiles = board.tiles.map(tile => {
        const placed: Tile = entrance ? { ...tile, justPlaced: true, dropDelay: board.dropDelays.get(tile.id) } : tile
        if (!step) return placed
        const staged: Tile = { ...placed, dimmed: dimOthers && !involved.has(tile.id), highlighted: tile.id === step.toolTileId }
        return tile.id === step.agentKey ? { ...staged, style: agentTileStyle(step.status, tile.ariaLabel ?? '') } : staged
    })

    const links: TileLink[] = board.links.map(link => (entrance ? { ...link, appearDelay: board.appearDelays.get(templateLinkId(link.source, link.target)) } : link))
    if (step?.toolTileId && step.status === 'working') links.push({ source: step.agentKey, target: step.toolTileId, variant: 'beam' })
    if (step?.handoffTileId) links.push({ source: step.agentKey, target: step.handoffTileId, variant: 'beam' })

    const focusTileIds = !step || step.camera === 'wide' ? board.tiles.map(tile => tile.id) : [...involved]
    const artifact =
        step && (step.artifact || step.actions.length > 0)
            ? {
                  stepId: step.id,
                  anchorTileId: step.toolTileId ?? step.agentKey,
                  actions: step.actions,
                  result: step.artifact,
                  toolSlug: step.toolTileId ? step.toolSlug : null,
              }
            : null

    return { tiles, links, focusTileIds, artifact }
}

export function storyEntranceMs(board: StoryBoard) {
    return Math.max(0, ...board.wakeDelays.values())
}
