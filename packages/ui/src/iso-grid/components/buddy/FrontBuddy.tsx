'use client'

import { useId } from 'react'
import type { BuddyLook } from '../../types'
import { BUDDY_GEOMETRY } from './BuddyArt'
import { BUDDY_FACE_CENTER, BuddyFace } from './BuddyFace'
import { BUDDY_STATE_COLOR, hashedBuddyLook, shade, type BuddyMood } from './buddy-look'
import { useBuddyLookOf } from './buddy-looks'
import { ChromeDefs, ChromeWall, KnitDefs, MATERIAL_RADIUS, MATERIAL_SIDE, MaterialFilter } from './BuddyMaterial'

// The front wall is the iso wall the face is painted on, drawn square to the viewer and 1.75 times
// larger, so the face keeps its proportions.
const SCALE = 1.75
const WALL_W = BUDDY_GEOMETRY.halfW * SCALE
const WALL_H = BUDDY_GEOMETRY.depth * SCALE
// The top, seen from a little above: its back edge narrower than its front one.
const TOP_DEPTH = 34
const BACK_W = WALL_W * 0.8
const CX = 50
const TOP_Y = 38
const WALL_Y = TOP_Y + TOP_DEPTH
const VIEW = { x: 4, y: 26, w: 92, h: 92 }

function roundedPolygon(points: { x: number; y: number }[], radius: number) {
    const fmt = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    const toward = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const length = Math.hypot(to.x - from.x, to.y - from.y)
        const t = Math.min(0.5, radius / length)
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
    }
    let d = ''
    points.forEach((corner, i) => {
        const before = toward(corner, points[(i + points.length - 1) % points.length])
        const after = toward(corner, points[(i + 1) % points.length])
        d += `${i ? ' L' : 'M'}${fmt(before)} Q${fmt(corner)} ${fmt(after)}`
    })
    return `${d} Z`
}

type FrontBuddyProps = {
    agentId: string
    // Drawn instead of the look its coworker wears, as AgentBuddy's.
    look?: BuddyLook
    mood?: BuddyMood
    size: number
}

// The buddy turned to face you: the same block, colour, material and face as on the board, its
// face wall square to the viewer and its top seen from a little above. A 2D transform of the iso
// drawing cannot give this view, so it is drawn on its own.
export function FrontBuddy({ agentId, look: shownLook, mood = 'idle', size }: FrontBuddyProps) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const wornLook = useBuddyLookOf(agentId)
    const worn = { ...hashedBuddyLook(agentId), ...(shownLook ?? wornLook) }
    const material = worn.material ?? 'classic'
    const classic = material === 'classic'
    const glass = material === 'glass'
    const chrome = material === 'chrome'
    const knit = material === 'knit'
    const resting = mood === 'idle' || mood === 'asleep'
    const identity = worn.color
    const body = mood === 'idle' && !classic ? identity : BUDDY_STATE_COLOR[mood]
    const top = resting ? shade(identity, mood === 'asleep' ? -0.6 : classic ? -0.12 : 0.06) : body
    const radius = (MATERIAL_RADIUS[material] ?? 9) * 0.7
    const detail = size / VIEW.w

    const left = CX - WALL_W / 2
    const right = CX + WALL_W / 2
    const topShape = roundedPolygon(
        [
            { x: CX - BACK_W / 2, y: TOP_Y },
            { x: CX + BACK_W / 2, y: TOP_Y },
            { x: right, y: WALL_Y },
            { x: left, y: WALL_Y },
        ],
        radius,
    )
    const silhouette = roundedPolygon(
        [
            { x: CX - BACK_W / 2, y: TOP_Y },
            { x: CX + BACK_W / 2, y: TOP_Y },
            { x: right, y: WALL_Y },
            { x: right, y: WALL_Y + WALL_H },
            { x: left, y: WALL_Y + WALL_H },
            { x: left, y: WALL_Y },
        ],
        radius,
    )
    const [lit, fold] = MATERIAL_SIDE[material]

    return (
        <svg
            viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
            width={size}
            height={size}
            aria-hidden
            data-buddy-alive=""
            style={{ overflow: 'visible', ['--iso-buddy-body' as string]: 'var(--iso-buddy-mascot-body)' }}
        >
            <defs>
                <linearGradient id={`${uid}-wall`} x1="0" y1={WALL_Y} x2="0" y2={WALL_Y + WALL_H} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" style={{ stopColor: shade(body, lit[1]) }} />
                    <stop offset="100%" style={{ stopColor: shade(body, fold[1] - 0.1) }} />
                </linearGradient>
                <linearGradient id={`${uid}-wall-sides`} x1={left} x2={right} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#000" stopOpacity="0.22" />
                    <stop offset="12%" stopColor="#000" stopOpacity="0" />
                    <stop offset="88%" stopColor="#000" stopOpacity="0" />
                    <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
                </linearGradient>
                {chrome ? (
                    <ChromeDefs uid={uid} tint={mood === 'idle' ? { color: identity, share: 20 } : { color: body, share: 42 }} depth={WALL_H} />
                ) : (
                    <radialGradient id={`${uid}-top`} cx="42%" cy="40%" r="75%">
                        <stop offset="0%" style={{ stopColor: shade(top, glass ? 0.5 : mood === 'idle' ? 0.12 : 0.22) }} />
                        <stop offset="100%" style={{ stopColor: shade(top, glass ? 0.1 : -0.04) }} />
                    </radialGradient>
                )}
                <clipPath id={`${uid}-body`}>
                    <path d={silhouette} />
                </clipPath>
                {!classic && <MaterialFilter id={`${uid}-material`} material={material} detail={detail} />}
                {knit && <KnitDefs uid={uid} color={body} />}
            </defs>

            <ellipse cx={CX} cy={WALL_Y + WALL_H + 3} rx={WALL_W * 0.46} ry={4} fill="#000" opacity={0.22} filter="blur(2px)" />

            <g filter={classic ? undefined : `url(#${uid}-material)`}>
                <g clipPath={`url(#${uid}-body)`}>
                    {chrome ? (
                        <g transform={`translate(${left} ${WALL_Y}) scale(${WALL_W / BUDDY_GEOMETRY.halfW} 1)`}>
                            <ChromeWall uid={uid} side="left" geometry={{ base: { x: 0, y: 0 }, halfW: BUDDY_GEOMETRY.halfW, halfH: BUDDY_GEOMETRY.halfH, depth: WALL_H, radius }} />
                        </g>
                    ) : (
                        <>
                            <rect x={left - 2} y={WALL_Y - 2} width={WALL_W + 4} height={WALL_H + 4} fill={`url(#${uid}-wall)`} fillOpacity={glass ? 0.62 : 1} />
                            <rect x={left - 2} y={WALL_Y - 2} width={WALL_W + 4} height={WALL_H + 4} fill={`url(#${uid}-wall-sides)`} />
                        </>
                    )}
                    {knit && <rect x={left - 2} y={WALL_Y - 2} width={WALL_W + 4} height={WALL_H + 4} fill={`url(#${uid}-knit)`} />}
                </g>
                <path d={topShape} fill={`url(#${uid}-top)`} fillOpacity={glass ? 0.72 : 1} />
                {knit && <path d={topShape} fill={`url(#${uid}-knit)`} />}
                {classic && <path d={topShape} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.7} />}
                {chrome && <path d={topShape} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={0.55} />}
                {glass && <ellipse cx={CX - 12} cy={TOP_Y + 9} rx={14} ry={2.6} fill="#fff" fillOpacity={0.5} />}
            </g>

            <g clipPath={`url(#${uid}-body)`}>
                <g transform={`translate(${CX - BUDDY_FACE_CENTER * SCALE} ${WALL_Y}) scale(${SCALE})`}>
                    <BuddyFace uid={uid} eyes={worn.eyes} mouth={worn.mouth} mood={mood} depth={BUDDY_GEOMETRY.depth} light={resting ? shade(identity, 0.35) : '#fff'} lit tint={resting ? identity : body} />
                </g>
            </g>
        </svg>
    )
}
