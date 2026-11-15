import { BUDDY_GEOMETRY } from '../iso-grid/components/buddy/BuddyArt'
import { BUDDY_FACE_CENTER } from '../iso-grid/components/buddy/BuddyFace'

import type { OrbActivity } from './Orb'

export type ForemanFace = 'plate' | 'bare'
export type ForemanFacing = 'left' | 'right' | 'front'

export const FOREMAN_VIEW_MARGIN = 2
export const FOREMAN_VIEW_WIDTH = BUDDY_GEOMETRY.halfW * 2 + FOREMAN_VIEW_MARGIN * 2

export const SMALL_BELOW = 40
export const LISTENING_FACE_SCALE = 1.1
const PLATE = { width: 27, height: 14, radius: 6 }
export const FACE_EYE_SHARE = 0.45

type Motion = { amp: number; period: number; sheenPeriod: number }

export const MOTION: Record<OrbActivity, Motion> = {
    idle: { amp: 0, period: 0, sheenPeriod: 6 },
    listening: { amp: 0.03, period: 2.8, sheenPeriod: 6 },
    thinking: { amp: 0.09, period: 1.1, sheenPeriod: 1.8 },
    speaking: { amp: 0.05, period: 0.45, sheenPeriod: 4 },
}

export function ForemanFacePlate({ uid, y, colors }: { uid: string; y: number; colors: [upper: string, lower: string] }) {
    const x = BUDDY_FACE_CENTER - PLATE.width / 2
    const top = y - PLATE.height / 2
    return (
        <>
            <defs>
                <linearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors[0]} />
                    <stop offset="100%" stopColor={colors[1]} />
                </linearGradient>
            </defs>
            <rect x={x} y={top + 0.7} width={PLATE.width} height={PLATE.height} rx={PLATE.radius} fill="#fff" fillOpacity={0.45} />
            <rect x={x} y={top} width={PLATE.width} height={PLATE.height} rx={PLATE.radius} fill={`url(#${uid}-plate)`} />
            <rect x={x + 2} y={top + 1.2} width={PLATE.width - 4} height={PLATE.height * 0.4} rx={PLATE.radius - 2} fill="#fff" fillOpacity={0.07} />
        </>
    )
}
