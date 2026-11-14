import type { BuddyMood } from './buddy-look'
import { BUDDY_GEOMETRY } from './BuddyArt'

export const CAPSULE_STEEL = '#94a3b8'
export const CAPSULE_STEEL_DEEP = '#64748b'
export const CAPSULE_HELD = '#ef4444'
const CAPSULE_HELD_DEEP = '#b91c1c'

const HALF_W = 28
const HALF_H = HALF_W / 2

export function CapsuleArt({ uid, mood, plain }: { uid: string; mood: BuddyMood; plain?: string }) {
    const held = mood === 'waiting'
    const lit = mood === 'working'
    const { x, y } = BUDDY_GEOMETRY.base
    const topY = y - BUDDY_GEOMETRY.depth
    const light = plain ?? (held ? CAPSULE_HELD : CAPSULE_STEEL)
    const deep = plain ?? (held ? CAPSULE_HELD_DEEP : CAPSULE_STEEL_DEEP)
    const left = x - HALF_W
    const right = x + HALF_W
    const body = `M ${left} ${topY} L ${left} ${y} A ${HALF_W} ${HALF_H} 0 0 0 ${right} ${y} L ${right} ${topY} Z`
    return (
        <g data-capsule="" data-lit={lit ? '' : undefined} data-held={held ? '' : undefined} style={lit ? { filter: `drop-shadow(0 0 7px ${CAPSULE_STEEL})` } : undefined}>
            <defs>
                <linearGradient id={`${uid}-capsule`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={light} />
                    <stop offset="100%" stopColor={deep} />
                </linearGradient>
            </defs>
            <path d={body} fill={`url(#${uid}-capsule)`} />
            <ellipse cx={x} cy={topY} rx={HALF_W} ry={HALF_H} fill={light} />
        </g>
    )
}
