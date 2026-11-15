'use client'

import { TOUR_CURSOR_OFFSETS, TOUR_TEAMMATES, type TourTeammate } from './tour-team'
import { tourAgentWorldCenter } from './tour-board'
import { CursorMark } from '../cursors'
import { usePrefersReducedMotion } from '../iso-grid/hooks/usePrefersReducedMotion'
import { useIsMobile } from '../primitives/use-is-mobile'
import { AnimatePresence, arc, motion } from 'motion/react'

const CURSOR_SCALE = 1.45
const TRAVEL_SECONDS = 0.78
const TRAVEL_EASE = [0.22, 1, 0.36, 1] as const

const CURSOR_PATHS: Record<string, ReturnType<typeof arc>> = {
    theo: arc({ strength: 0.12, peak: 0.44, direction: 'cw' }),
    sofia: arc({ strength: 0.1, peak: 0.54, direction: 'ccw' }),
    noah: arc({ strength: 0.14, peak: 0.48, direction: 'cw' }),
}
const DEFAULT_CURSOR_PATH = arc({ strength: 0.12 })

type CursorGesture = { x: number[]; y: number[]; delay: number }

const CURSOR_GESTURES: Record<string, CursorGesture> = {
    theo: { x: [0, 3, 1, -2, 0], y: [0, -2, 2, 1, 0], delay: 0.84 },
    sofia: { x: [0, -2, 2, 3, 0], y: [0, 2, -1, 2, 0], delay: 0.98 },
    noah: { x: [0, 2, -3, -1, 0], y: [0, -2, 1, 3, 0], delay: 1.12 },
}
const DEFAULT_CURSOR_GESTURE: CursorGesture = { x: [0, 2, -2, 0], y: [0, -2, 2, 0], delay: 0.9 }

type PositionedTeammate = TourTeammate & { x: number; y: number }

export function TourBoardCursors({ at, present, zoom }: { at: Record<string, string>; present: readonly string[]; zoom: number }) {
    const reducedMotion = usePrefersReducedMotion()
    const isMobile = useIsMobile()
    const cursors: PositionedTeammate[] = TOUR_TEAMMATES.filter(mate => present.includes(mate.id)).map(mate => {
        const center = tourAgentWorldCenter(at[mate.id] ?? mate.home)
        const offset = TOUR_CURSOR_OFFSETS[mate.id] ?? { x: 0, y: 0 }
        return { ...mate, x: center.x + offset.x, y: center.y + offset.y }
    })

    return (
        <AnimatePresence>
            {cursors.map(cursor => (
                <TourCursor key={cursor.id} cursor={cursor} zoom={zoom} reducedMotion={reducedMotion} compact={isMobile} />
            ))}
        </AnimatePresence>
    )
}

function TourCursor({ cursor, zoom, reducedMotion, compact }: { cursor: PositionedTeammate; zoom: number; reducedMotion: boolean; compact: boolean }) {
    const gesture = CURSOR_GESTURES[cursor.id] ?? DEFAULT_CURSOR_GESTURE
    const destinationKey = `${cursor.x}:${cursor.y}`
    const screenScale = CURSOR_SCALE / zoom

    return (
        <motion.div
            style={{ position: 'absolute', transformOrigin: '0 0', pointerEvents: 'none', zIndex: 1000000, willChange: 'transform, opacity' }}
            initial={reducedMotion ? false : { x: cursor.x, y: cursor.y, scale: 0, opacity: 0 }}
            animate={{ x: cursor.x, y: cursor.y, scale: screenScale, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={
                reducedMotion
                    ? { duration: 0 }
                    : {
                          path: CURSOR_PATHS[cursor.id] ?? DEFAULT_CURSOR_PATH,
                          x: { duration: TRAVEL_SECONDS, ease: TRAVEL_EASE },
                          scale: { duration: 0.15 },
                          opacity: { duration: 0.15 },
                      }
            }
        >
            <motion.div
                key={destinationKey}
                className={cursor.id === 'noah' ? 'max-sm:[&>div]:right-4 max-sm:[&>div]:left-auto max-sm:[&>div]:-translate-y-10 max-sm:[&>div]:flex-row-reverse' : undefined}
                initial={{ x: 0, y: 0 }}
                animate={reducedMotion ? { x: 0, y: 0 } : { x: gesture.x, y: gesture.y }}
                transition={reducedMotion ? { duration: 0 } : { duration: 3, delay: gesture.delay, ease: 'easeInOut' }}
            >
                <CursorMark name={cursor.name} role={compact ? undefined : cursor.role} color={cursor.color} photoUrl={cursor.photo} />
            </motion.div>
        </motion.div>
    )
}
