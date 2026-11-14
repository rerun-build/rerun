'use client'

import type { TemplateConnector, TemplateStoryStep } from '@rerun/contracts'
import { useEffect, useMemo, useState } from 'react'

import { cn } from '../cn'
import { IsoGrid } from '../iso-grid/IsoGrid'
import { CARD_WIDTH } from '../iso-grid/card-capture'
import { usePrefersReducedMotion } from '../iso-grid/hooks/usePrefersReducedMotion'
import { useRenderedFrame } from '../iso-grid/hooks/useRenderedFrame'
import { TILE_H } from '../iso-grid/iso'
import { type BoardAgent, type BoardFrame, buildTemplateBoard, frameTemplateBoard, tileWorldCenter, tileWorldRise } from '../iso-grid/template-board-geometry'
import type { IsoCamera, Tile } from '../iso-grid/types'
import { type StoryArtifactPlacement, StoryArtifactLayer, StoryDockedCard } from './StoryArtifactCard'
import { type StoryBoard, stageStory, storyEntranceMs, storyFrame } from './story-frame'

const NO_HIGHLIGHT: ReadonlySet<string> = new Set()

const ENTRANCE_SETTLE_MS = 500

const FOCUS_INSET = 0.62
const FOCUS_ZOOM_GAIN = 1.8

const ARTIFACT_LIFT = 46
const ARTIFACT_LIFT_OVER_HAND = 92

const ARTIFACT_HEIGHT = 94

const ARTIFACT_FULL_SIZE_WIDTH = 640
const ARTIFACT_MIN_SCALE = 0.72

const MIN_TILE_ROOM = 150
const DOCK_MARGIN = 10

const STORY_MAX_ZOOM = 3

function zoomCeiling(frame: BoardFrame) {
    return (STORY_MAX_ZOOM * frame.width) / CARD_WIDTH
}

function wideCamera(board: StoryBoard, frame: BoardFrame): IsoCamera {
    return frameTemplateBoard(board.tiles, frame, zoomCeiling(frame))
}

function closeUpMaxZoom(wide: IsoCamera, frame: BoardFrame) {
    return Math.min(wide.zoom * FOCUS_ZOOM_GAIN, zoomCeiling(frame))
}

function focusCamera(board: StoryBoard, tiles: Tile[], frame: BoardFrame, cardRoom: number): IsoCamera {
    const wide = wideCamera(board, frame)
    const room = Math.min(cardRoom, frame.height / 2)
    const close = frameTemplateBoard(tiles, { width: frame.width, height: frame.height - room }, closeUpMaxZoom(wide, frame), FOCUS_INSET)
    const zoom = Math.max(close.zoom, wide.zoom)
    return { zoom, pan: { x: close.pan.x, y: close.pan.y + room / 2 / zoom } }
}

function dockedCamera(board: StoryBoard, tiles: Tile[], frame: BoardFrame, room: number, close: boolean): IsoCamera {
    const wide = wideCamera(board, frame)
    const below = { width: frame.width, height: frame.height - room }
    const framed = close ? frameTemplateBoard(tiles, below, closeUpMaxZoom(wide, frame), FOCUS_INSET) : frameTemplateBoard(tiles, below, wide.zoom)
    return { zoom: framed.zoom, pan: { x: framed.pan.x, y: framed.pan.y + room / 2 / framed.zoom } }
}

export function TemplateStoryBoard({
    agents,
    connectors,
    steps,
    index,
    run = 0,
    playing = true,
    onEntered,
    className,
}: {
    agents: BoardAgent[]
    connectors: TemplateConnector[]
    steps: readonly TemplateStoryStep[]
    index: number
    run?: number
    playing?: boolean
    onEntered?: () => void
    className?: string
}) {
    const { ref, frame } = useRenderedFrame()
    const reducedMotion = usePrefersReducedMotion()
    const board = useMemo(() => buildTemplateBoard(agents, connectors, NO_HIGHLIGHT), [agents, connectors])
    const staged = useMemo(() => stageStory(steps, board), [steps, board])
    const [entered, setEntered] = useState(false)

    useEffect(() => {
        if (reducedMotion) {
            setEntered(true)
            return
        }
        const timer = window.setTimeout(() => setEntered(true), storyEntranceMs(board) + ENTRANCE_SETTLE_MS)
        return () => window.clearTimeout(timer)
    }, [board, reducedMotion])

    useEffect(() => {
        if (entered) onEntered?.()
    }, [entered, onEntered])

    const step = entered ? (staged[index] ?? null) : null
    const scene = useMemo(() => storyFrame(step, board, { entrance: !reducedMotion }), [step, board, reducedMotion])

    const artifact = useMemo<StoryArtifactPlacement | null>(() => {
        if (!scene.artifact || !frame) return null
        const scale = Math.min(1, Math.max(ARTIFACT_MIN_SCALE, frame.width / ARTIFACT_FULL_SIZE_WIDTH))
        const anchor = board.tiles.find(tile => tile.id === scene.artifact?.anchorTileId)
        if (!anchor) return null
        const center = tileWorldCenter(anchor)
        const overHand = step?.status === 'waiting_human' && anchor.id === step.agentKey
        const connector = scene.artifact.toolSlug ? connectors.find(c => c.slug === scene.artifact?.toolSlug) : undefined
        const agent = agents.find(a => a.key === step?.agentKey)
        return {
            key: `${scene.artifact.stepId}:${run}`,
            x: center.x,
            y: center.y - ((anchor.span ?? 2) * TILE_H) / 2 - tileWorldRise(anchor),
            lift: overHand ? ARTIFACT_LIFT_OVER_HAND : ARTIFACT_LIFT,
            scale,
            header: connector ? { name: connector.name, icon: connector.icon } : { name: agent?.name ?? '', icon: null },
            actions: scene.artifact.actions,
            result: scene.artifact.result,
        }
    }, [board, frame, scene, step, run, agents, connectors])

    const docked = artifact !== null && frame !== null && frame.height < ARTIFACT_LIFT_OVER_HAND + ARTIFACT_HEIGHT * artifact.scale + MIN_TILE_ROOM

    const camera = useMemo(() => {
        if (!frame) return null
        if (docked && artifact) {
            const focus = new Set(scene.focusTileIds)
            const room = DOCK_MARGIN * 2 + ARTIFACT_HEIGHT * artifact.scale
            return dockedCamera(
                board,
                board.tiles.filter(tile => focus.has(tile.id)),
                frame,
                room,
                step?.camera === 'agent',
            )
        }
        if (!step || step.camera === 'wide') return wideCamera(board, frame)
        const focus = new Set(scene.focusTileIds)
        const cardRoom = artifact ? artifact.lift + ARTIFACT_HEIGHT * artifact.scale : 0
        return focusCamera(
            board,
            board.tiles.filter(tile => focus.has(tile.id)),
            frame,
            cardRoom,
        )
    }, [board, frame, step, scene, artifact, docked])

    if (board.agentCount === 0) return null

    return (
        <div ref={ref} aria-hidden className={cn('relative overflow-hidden', className)}>
            {camera && (
                <IsoGrid
                    tiles={scene.tiles}
                    containers={[]}
                    liveLinks={scene.links}
                    selectedTileId={null}
                    camera={camera}
                    scrollGestures={false}
                    locked
                    canDraw={false}
                    className="size-full"
                    worldOverlay={zoom => <StoryArtifactLayer artifact={docked ? null : artifact} zoom={zoom} playing={playing} reducedMotion={reducedMotion} />}
                />
            )}
            <StoryDockedCard artifact={docked ? artifact : null} top={DOCK_MARGIN} playing={playing} reducedMotion={reducedMotion} />
        </div>
    )
}
