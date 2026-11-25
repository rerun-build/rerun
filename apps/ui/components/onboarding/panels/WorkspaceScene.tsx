'use client'

import { cn } from '@/lib/utils'
import { CursorMark } from '@rerun/ui/cursors'
import { IsoGrid, useRenderedFrame } from '@rerun/ui/iso-grid'
import { frameTourStage, LAST_TOUR_PHASE, TOUR_CONNECTORS, TOUR_CURSOR_OFFSETS, TOUR_MASK, TOUR_TEAMMATES, tourAgentWorldCenter, useTourStage } from '@rerun/ui/tour'
import { motion } from 'motion/react'
import { useMemo } from 'react'

const CONNECTOR_IDS = new Set(TOUR_CONNECTORS.map(connector => connector.id))
const CURSOR_SCALE = 1.2
const ABOVE_THE_BOARD = 1_000_000

// The workspace of the app's tour, its Boxes and their coworkers living, without the app tiles nor the
// cables to them, framed on the bare Boxes. The teammates are only small cursors.
export function WorkspaceScene({ className }: { className?: string }) {
    const { ref, frame } = useRenderedFrame()
    const camera = useMemo(() => (frame ? frameTourStage(frame, { connectors: false }) : null), [frame])
    const stage = useTourStage({ phase: LAST_TOUR_PHASE, active: true, modelShot: null, focused: false })
    const tiles = useMemo(() => stage.tiles.filter(tile => !CONNECTOR_IDS.has(tile.id)), [stage.tiles])
    const links = useMemo(() => stage.links.filter(link => !CONNECTOR_IDS.has(link.source) && !CONNECTOR_IDS.has(link.target)), [stage.links])

    return (
        <div ref={ref} dir="ltr" className={cn('relative overflow-hidden', className)}>
            {camera && (
                <IsoGrid
                    tiles={tiles}
                    containers={stage.containers}
                    liveLinks={links}
                    selectedTileId={null}
                    camera={camera}
                    mask={TOUR_MASK}
                    canDraw={false}
                    locked
                    className="size-full"
                    worldOverlay={zoom => (
                        <>
                            {TOUR_TEAMMATES.filter(mate => stage.presentIds.includes(mate.id)).map(mate => {
                                const center = tourAgentWorldCenter(stage.cursorsAt[mate.id] ?? mate.home)
                                const offset = TOUR_CURSOR_OFFSETS[mate.id] ?? { x: 0, y: 0 }
                                return (
                                    <motion.div
                                        key={mate.id}
                                        className="pointer-events-none absolute origin-top-left"
                                        style={{ zIndex: ABOVE_THE_BOARD }}
                                        initial={false}
                                        animate={{ x: center.x + offset.x, y: center.y + offset.y, scale: CURSOR_SCALE / zoom }}
                                        transition={{ duration: 0.78, ease: [0.22, 1, 0.36, 1] }}
                                    >
                                        <CursorMark name={mate.name} color={mate.color} />
                                    </motion.div>
                                )
                            })}
                        </>
                    )}
                />
            )}
        </div>
    )
}
