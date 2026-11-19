'use client'

import { IsoGrid } from '@moldwright/ui/iso-grid'

import { useAuthStage } from './useAuthStage'

const MAX_ZOOM = 2

const OVERSCAN = 1.27
const FRAME_INSET = `${((1 - OVERSCAN) / 2) * 100}%`

const MASK = `radial-gradient(ellipse ${(72 / OVERSCAN).toFixed(1)}% ${(74 / OVERSCAN).toFixed(1)}% at 50% 50%, black 78%, transparent 100%)`

export function AuthStageBoard() {
    const { stage, tiles, links } = useAuthStage()

    return (
        <div className="absolute" style={{ inset: FRAME_INSET }}>
            <IsoGrid
                tiles={tiles}
                containers={stage.containers}
                liveLinks={links}
                selectedTileId={null}
                worldAnchor={{ left: '50%', top: '50%' }}
                fitToContent
                initialZoomDesktop={MAX_ZOOM}
                initialZoomMobile={MAX_ZOOM}
                mask={MASK}
                scrollGestures={false}
            />
        </div>
    )
}
