'use client'

import { motion } from 'motion/react'

const HEAD_LEN = 4
const MAX_LEN = 36
const STEPS = 16

function mix(a: string, b: string, t: number) {
    const parse = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    const [ar, ag, ab] = parse(a)
    const [br, bg, bb] = parse(b)
    const c = (x: number, y: number) => Math.round(x + (y - x) * t)
    return `rgb(${c(ar, br)}, ${c(ag, bg)}, ${c(ab, bb)})`
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const TAIL_COLOR = '#4028d9'
const HEAD_COLOR = '#f5ecff'

const TRAIL = Array.from({ length: STEPS }, (_, i) => {
    const t = i / (STEPS - 1)
    return {
        len: lerp(MAX_LEN, HEAD_LEN, t),
        color: mix(TAIL_COLOR, HEAD_COLOR, t),
        opacity: lerp(0.05, 0.95, t),
        width: lerp(3, 1, t),
    }
})

const P_START = -8
const P_END = 138

export function PulseBeam({ d, dur, delay, gap }: { d: string; dur: number; delay: number; gap: number }) {
    const transition = { duration: dur, ease: 'linear' as const, repeat: Infinity, repeatDelay: gap, delay }
    return (
        <>
            {TRAIL.map((t, i) => (
                <motion.path
                    key={i}
                    d={d}
                    pathLength={100}
                    fill="none"
                    stroke={t.color}
                    strokeOpacity={t.opacity}
                    strokeWidth={t.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={`${t.len} 1000`}
                    initial={{ strokeDashoffset: t.len - P_START }}
                    animate={{ strokeDashoffset: t.len - P_END }}
                    transition={transition}
                />
            ))}
        </>
    )
}
