'use client'

import { agentTileStyle } from '@moldwright/ui/iso-grid'
import { useReducedMotion } from 'motion/react'
import { useMemo } from 'react'

import { buildAuthStage, stageLinkId } from './auth-stage-board'
import { useStageScript } from './useStageScript'

export function useAuthStage() {
    const stage = useMemo(() => buildAuthStage(), [])
    const animated = !useReducedMotion()

    const { statuses, hotLinks } = useStageScript({ script: stage.script, enabled: animated })

    const hot = useMemo(() => new Set(Object.values(hotLinks).flat()), [hotLinks])

    const tiles = useMemo(() => {
        if (!animated) return stage.tiles
        return stage.tiles.map(tile => {
            const placed = { ...tile, justPlaced: true, dropDelay: stage.dropDelays.get(tile.id) }
            const status = statuses[tile.id]
            if (!status || status === 'idle') return placed
            return { ...placed, style: agentTileStyle(status, tile.ariaLabel ?? '') }
        })
    }, [animated, stage, statuses])

    const links = useMemo(() => {
        if (!animated) return []
        return stage.links.flatMap(link => {
            const id = stageLinkId(link.source, link.target)
            if (link.variant === 'cable') return [{ ...link, appearDelay: stage.appearDelays.get(id) }]
            return hot.has(id) ? [link] : []
        })
    }, [animated, stage, hot])

    return { stage, tiles, links, statuses, animated }
}
