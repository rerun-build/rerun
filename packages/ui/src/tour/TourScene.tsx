'use client'

import { IsoGrid } from '../iso-grid/IsoGrid'
import { useRenderedFrame } from '../iso-grid/hooks/useRenderedFrame'
import { cn } from '../cn'
import { useMemo } from 'react'

import { TourBoardCursors } from './TourBoardCursors'
import { TourModelPills } from './TourModelPills'
import { frameTourPhase, frameTourStage } from './tour-board'
import { tourModelShot } from './tour-models'
import { useTourStage } from './useTourStage'

export const TOUR_MASK = 'radial-gradient(ellipse 86% 88% at 50% 50%, black 62%, transparent 100%)'

const CAMERA_TRANSITION_MS = 620

export type TourSceneProps = {
    phase: number
    active: boolean
    bandTop?: number
    bandBottom?: number
    wide?: boolean
    connectors?: boolean
    focused?: boolean
    className?: string
}

export function TourScene({ phase, active, bandTop = 0, bandBottom = 0, wide = false, connectors = true, focused, className }: TourSceneProps) {
    const { ref, frame } = useRenderedFrame()

    const stageFrame = useMemo(() => (frame ? { width: frame.width, height: Math.max(frame.height - bandTop - bandBottom, 1) } : null), [frame, bandTop, bandBottom])
    const camera = useMemo(() => (stageFrame ? (wide ? frameTourStage(stageFrame, { connectors }) : frameTourPhase(phase, stageFrame)) : null), [phase, stageFrame, wide, connectors])

    const modelShot = useMemo(() => (camera && stageFrame ? tourModelShot(camera, stageFrame) : null), [camera, stageFrame])
    const stage = useTourStage({ phase, active, modelShot, focused: wide ? false : focused })

    const anchorTop = frame ? `${((bandTop + (frame.height - bandTop - bandBottom) / 2) / frame.height) * 100}%` : '50%'

    return (
        <div ref={ref} aria-hidden className={cn('relative overflow-hidden', className)}>
            {camera && (
                <IsoGrid
                    tiles={stage.tiles}
                    containers={stage.containers}
                    liveLinks={stage.links}
                    selectedTileId={null}
                    worldAnchor={{ left: '50%', top: anchorTop }}
                    camera={camera}
                    cameraTransitionMs={CAMERA_TRANSITION_MS}
                    mask={TOUR_MASK}
                    canDraw={false}
                    locked
                    className="size-full"
                    worldOverlay={zoom => (
                        <>
                            <TourModelPills pills={stage.modelPills} zoom={zoom} />
                            <TourBoardCursors at={stage.cursorsAt} present={stage.presentIds} zoom={zoom} />
                        </>
                    )}
                />
            )}
        </div>
    )
}
