'use client'

import {
    agentTileStyle,
    connectorTileStyle,
    frameTemplateBoard,
    IsoGrid,
    templateLinkId,
    type Tile,
    type TileLink,
    useLivingBoard,
    usePrefersReducedMotion,
    useRenderedFrame,
} from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'

import { CHATGPT_MARK, CLAUDE_MARK, OPENROUTER_MARK } from './offer-board-marks'

// The template board puts a connector two cells out, which is right when an agent has a ring of
// them. Here each coworker has exactly one, and the point is that it belongs to it: the source tile
// sits one free cell above its agent, close enough that the cable between them reads as a tether.
// The three marks are the three answers the dialog offers, one per coworker.
const CREW = [
    { key: 'sales', col: 4, row: 7, mark: CLAUDE_MARK },
    { key: 'customer_support', col: 7, row: 7, mark: CHATGPT_MARK },
    { key: 'accounting', col: 10, row: 7, mark: OPENROUTER_MARK },
] as const

const PLAN_ROW_OFFSET = 2
const WAKE_STEP = 180
const MAX_ZOOM = 2.4

function planId(key: string) {
    return `${key}-plan`
}

export function OfferBoard({ className, alive = true }: { className?: string; alive?: boolean }) {
    const t = useTranslations('dialogs.subscriptionOffer.board.crew')
    const { ref, frame } = useRenderedFrame()
    const reducedMotion = usePrefersReducedMotion()
    const animated = alive && !reducedMotion

    const base = useMemo<Tile[]>(
        () => [
            ...CREW.map<Tile>(member => ({
                id: member.key,
                position: { col: member.col, row: member.row },
                span: 2,
                style: agentTileStyle('idle', t(member.key)),
                ariaLabel: t(member.key),
            })),
            ...CREW.map<Tile>(member => ({
                id: planId(member.key),
                position: { col: member.col, row: member.row - PLAN_ROW_OFFSET },
                span: 1,
                style: connectorTileStyle(member.mark),
                highlighted: true,
            })),
        ],
        [t]
    )

    const living = useLivingBoard({
        agentKeys: useMemo(() => CREW.map(member => member.key), []),
        linkIdsByAgent: useMemo(() => new Map(CREW.map(member => [member.key, [templateLinkId(member.key, planId(member.key))]])), []),
        startDelays: useMemo(() => new Map(CREW.map((member, index) => [member.key, index * WAKE_STEP])), []),
        enabled: animated,
        paused: false,
    })

    const tiles = useMemo(() => {
        if (!animated) return base
        return base.map(tile => {
            const status = living.statuses[tile.id]
            return status ? { ...tile, style: agentTileStyle(status, tile.ariaLabel ?? '') } : tile
        })
    }, [animated, base, living.statuses])

    const links = useMemo<TileLink[]>(() => {
        const hot = new Set(Object.values(living.hotLinks).filter((id): id is string => id !== null))
        return CREW.map(member => {
            const id = templateLinkId(member.key, planId(member.key))
            return { source: member.key, target: planId(member.key), variant: animated && hot.has(id) ? 'beam' : 'cable' }
        })
    }, [animated, living.hotLinks])

    const camera = frame ? frameTemplateBoard(base, frame, MAX_ZOOM) : null

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
