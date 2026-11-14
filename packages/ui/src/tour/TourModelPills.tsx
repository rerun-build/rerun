'use client'

import { AnimatePresence, motion } from 'motion/react'
import { ModelPill } from '../beams'

import type { TourModelPill } from './tour-models'

const ENTER = { duration: 0.36, ease: [0.22, 1, 0.36, 1] as const }
const LEAVE = { duration: 0.3, ease: [0.4, 0, 1, 1] as const }

export function TourModelPills({ pills, zoom }: { pills: readonly TourModelPill[]; zoom: number }) {
    return (
        <AnimatePresence>
            {pills.map(pill => (
                <motion.div
                    key={pill.key}
                    aria-hidden
                    style={{ position: 'absolute', left: pill.x, top: pill.y, translate: '-50% -50%', transformOrigin: '50% 50%', pointerEvents: 'none', zIndex: 999000 }}
                    animate={{ scale: 1 / zoom }}
                    transition={{ duration: 0.15 }}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.86, y: 10, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: ENTER }}
                        exit={{ opacity: 0, scale: 0.94, y: -12, filter: 'blur(3px)', transition: LEAVE }}
                    >
                        <ModelPill item={pill.item} />
                    </motion.div>
                </motion.div>
            ))}
        </AnimatePresence>
    )
}
