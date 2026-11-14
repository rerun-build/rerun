'use client'

import type { TemplateConnector } from '@rerun/contracts'
import { useMemo } from 'react'

import { cn } from '../cn'
import { IsoGrid } from './IsoGrid'
import { useLivingBoard } from './hooks/useLivingBoard'
import { useOnScreen } from './hooks/useOnScreen'
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion'
import { useRenderedFrame } from './hooks/useRenderedFrame'
import { agentTileStyle } from './presets'
import { type BoardAgent, buildTemplateBoard, frameTemplateBoard, templateLinkId } from './template-board-geometry'

export type { BoardAgent } from './template-board-geometry'

const DEFAULT_MAX_ZOOM = 1.8

export function TemplateBoardPreview({
    agents,
    connectors,
    className,
    maxZoom = DEFAULT_MAX_ZOOM,
    alive = false,
    highlightedConnectorSlugs,
}: {
    agents: BoardAgent[]
    connectors: TemplateConnector[]
    className?: string
    maxZoom?: number
    highlightedConnectorSlugs?: readonly string[]
    alive?: boolean
}) {
    const { ref, frame } = useRenderedFrame()
    const reducedMotion = usePrefersReducedMotion()
    const animated = alive && !reducedMotion
    const onScreen = useOnScreen(ref)

    const highlightedKey = [...(highlightedConnectorSlugs ?? [])].sort().join(',')
    const geometry = useMemo(() => buildTemplateBoard(agents, connectors, new Set(highlightedKey ? highlightedKey.split(',') : [])), [agents, connectors, highlightedKey])
    const { statuses, hotLinks } = useLivingBoard({
        agentKeys: geometry.agentKeys,
        linkIdsByAgent: geometry.linkIdsByAgent,
        startDelays: geometry.wakeDelays,
        enabled: animated,
        paused: !onScreen,
    })

    const tiles = useMemo(() => {
        if (!animated) return geometry.tiles
        return geometry.tiles.map(tile => {
            const status = statuses[tile.id]
            const placed = { ...tile, justPlaced: true, dropDelay: geometry.dropDelays.get(tile.id) }
            return status ? { ...placed, style: agentTileStyle(status, tile.ariaLabel ?? '') } : placed
        })
    }, [animated, geometry, statuses])

    const links = useMemo(() => {
        if (!animated) return geometry.links
        const hot = new Set(Object.values(hotLinks).filter((id): id is string => id !== null))
        return geometry.links.map(link => {
            const id = templateLinkId(link.source, link.target)
            return { ...link, appearDelay: geometry.appearDelays.get(id), variant: hot.has(id) ? ('beam' as const) : link.variant }
        })
    }, [animated, geometry, hotLinks])

    if (geometry.agentCount === 0) return null

    const camera = frame ? frameTemplateBoard(geometry.tiles, frame, maxZoom) : null

    return (
        <div ref={ref} className={cn('relative overflow-hidden', className)}>
            {camera && (
                <IsoGrid
                    tiles={tiles}
                    containers={[]}
                    liveLinks={links}
                    initialPan={camera.pan}
                    initialZoomDesktop={camera.zoom}
                    initialZoomMobile={camera.zoom}
                    scrollGestures={false}
                    canDraw={false}
                />
            )}
        </div>
    )
}
