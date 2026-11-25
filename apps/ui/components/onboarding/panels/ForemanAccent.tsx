'use client'

import { Orb } from '@/components/foreman/Orb'
import { cn } from '@/lib/utils'
import { motion } from 'motion/react'

const SIZE = 84
// Where the window's top edge crosses the accent: the orb shows from the eyes up and the hands rest
// on the edge.
const EDGE = 62
const SPARK = 'M12 0c.6 5.6 6.4 11.4 12 12-5.6.6-11.4 6.4-12 12-.6-5.6-6.4-11.4-12-12C5.6 11.4 11.4 5.6 12 0z'

// The Chief of Staff peeking over the edge of a window, the way a colleague leans over a desk: its
// body behind the frame, two hands in front of it. The window sits between the two layers
// (`relative z-10`), and its container is the one this is placed in.
export function ForemanAccent({ facing = 'left', delay = 0, className }: { facing?: 'left' | 'right'; delay?: number; className?: string }) {
    const tilt = facing === 'left' ? -10 : 10
    const box = cn('pointer-events-none absolute -top-[3.875rem]', className)
    const sparks = [
        { x: facing === 'left' ? -26 : SIZE + 8, y: -4, size: 18, beat: 0 },
        { x: facing === 'left' ? -8 : SIZE - 6, y: -24, size: 11, beat: 0.8 },
    ]
    return (
        <>
            <div aria-hidden className={cn(box, 'z-0')} style={{ width: SIZE, height: SIZE }}>
                <motion.div animate={{ y: [2, -5, 2], rotate: [tilt, tilt * 0.3, tilt] }} transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay }}>
                    <Orb size={SIZE} state="listening" facing={facing} />
                </motion.div>
                {sparks.map(spark => (
                    <motion.svg
                        key={spark.beat}
                        viewBox="0 0 24 24"
                        className="absolute fill-[color-mix(in_oklab,var(--brand),white_55%)]"
                        style={{ left: spark.x, top: spark.y, width: spark.size, height: spark.size }}
                        animate={{ opacity: [0.25, 1, 0.25], scale: [0.6, 1.15, 0.6], rotate: [0, 35, 0] }}
                        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: delay + spark.beat }}
                    >
                        <path d={SPARK} />
                    </motion.svg>
                ))}
            </div>
            <div aria-hidden className={cn(box, 'z-20')} style={{ width: SIZE, height: SIZE }}>
                {[10, SIZE - 32].map(x => (
                    <span
                        key={x}
                        className="absolute h-3.5 w-[22px] rounded-full shadow-md shadow-black/30"
                        style={{
                            left: x,
                            top: EDGE - 7,
                            background: 'radial-gradient(120% 140% at 35% 25%, color-mix(in oklab, var(--brand), white 35%), var(--brand) 55%, color-mix(in oklab, var(--brand), black 35%))',
                        }}
                    />
                ))}
            </div>
        </>
    )
}
