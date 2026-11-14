'use client'

import { useId, type CSSProperties, type ReactNode, type RefObject } from 'react'

import { cn } from '../cn'
import { BUDDY_FACE_CENTER, BuddyFace } from '../iso-grid/components/buddy/BuddyFace'
import type { BuddyEyes } from '../iso-grid/types'

import type { OrbActivity } from './Orb'
import { FACE_EYE_SHARE, FOREMAN_VIEW_MARGIN, FOREMAN_VIEW_WIDTH, ForemanFacePlate, LISTENING_FACE_SCALE, MOTION, SMALL_BELOW, type ForemanFace, type ForemanFacing } from './foreman-face'
import { FOREMAN_MATERIALS, type ForemanMaterialKey } from './foreman-materials'

const RADIUS = 40
const CENTER = { x: 50, y: 44 }
const FLOOR = CENTER.y + RADIUS
const MARGIN = FOREMAN_VIEW_MARGIN
const BELOW_FLOOR = 5
const VIEW_HEIGHT = RADIUS * 2 + MARGIN + BELOW_FLOOR
export const FOREMAN_BALL_FLOOR_SHARE = BELOW_FLOOR / FOREMAN_VIEW_WIDTH
export const FOREMAN_BALL_FRAME = { scale: FOREMAN_VIEW_WIDTH / (RADIUS * 2), inset: MARGIN / (RADIUS * 2) }

const FACE_SCALE = 1.4
const SMALL_FACE_SCALE = 1.7
const FACE_AT = { x: CENTER.x - 9, y: CENTER.y - 3 }
const FACE_LEAN = 0.2
const MAX_FACE_LEAN = 0.35
const EYE_Y = 10

const REST_PITCH = Math.asin((CENTER.y - FACE_AT.y) / RADIUS)
export const FOREMAN_FACE_REST = { yaw: Math.asin((FACE_AT.x - CENTER.x) / (RADIUS * Math.cos(REST_PITCH))), pitch: REST_PITCH }

export function foremanFacePose(yaw: number, pitch: number) {
    const towards = Math.cos(yaw)
    if (towards <= 0) return 'scale(0)'
    const x = CENTER.x + RADIUS * Math.sin(yaw) * Math.cos(pitch)
    const y = CENTER.y - RADIUS * Math.sin(pitch)
    const lean = Math.max(-MAX_FACE_LEAN, Math.min(MAX_FACE_LEAN, (FACE_LEAN * Math.sin(yaw)) / Math.sin(FOREMAN_FACE_REST.yaw)))
    const scaleX = towards / Math.cos(FOREMAN_FACE_REST.yaw)
    const scaleY = Math.cos(pitch) / Math.cos(FOREMAN_FACE_REST.pitch)
    return `translate(${x.toFixed(3)} ${y.toFixed(3)}) matrix(1 ${lean.toFixed(4)} 0 1 0 0) scale(${scaleX.toFixed(4)} ${scaleY.toFixed(4)})`
}

const REST_YAW_SIDE: Record<ForemanFacing, number> = { left: 1, front: 0, right: -1 }

export function foremanFaceRest(facing: ForemanFacing) {
    return { yaw: FOREMAN_FACE_REST.yaw * REST_YAW_SIDE[facing], pitch: FOREMAN_FACE_REST.pitch }
}

function FromFloor({ className, children }: { className: string; children: ReactNode }) {
    return (
        <g transform={`translate(${CENTER.x} ${FLOOR})`}>
            <g className={className}>
                <g transform={`translate(${-CENTER.x} ${-FLOOR})`}>{children}</g>
            </g>
        </g>
    )
}

export function foremanBallHeight(size: number, scale: number) {
    return (size * scale * VIEW_HEIGHT) / FOREMAN_VIEW_WIDTH
}

type ForemanBallProps = {
    material: ForemanMaterialKey
    scale: number
    size: number
    face?: ForemanFace
    eyes?: BuddyEyes
    state?: OrbActivity
    animated?: boolean
    facing?: ForemanFacing
    eyesRef?: RefObject<SVGGElement | null>
    faceRef?: RefObject<SVGGElement | null>
    className?: string
}

export function ForemanBall({ material: materialKey, scale, size, face = 'plate', eyes = 'pill', state = 'idle', animated = true, facing = 'left', eyesRef, faceRef, className }: ForemanBallProps) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const material = FOREMAN_MATERIALS[materialKey]
    const paint = material.ball
    const width = size * scale

    const small = width < SMALL_BELOW
    const faceScale = (small ? SMALL_FACE_SCALE : FACE_SCALE) * (state === 'listening' ? LISTENING_FACE_SCALE : 1)
    const darkInk = face === 'bare' && material.bareInk === 'dark'

    const motion = MOTION[state]
    const moving = animated && motion.amp > 0
    const viewBox = `${CENTER.x - FOREMAN_VIEW_WIDTH / 2} ${CENTER.y - RADIUS - MARGIN} ${FOREMAN_VIEW_WIDTH} ${VIEW_HEIGHT}`
    const outline = material.outline.length > 1 ? `url(#${uid}-outline)` : material.outline[0]
    const sphere = { cx: CENTER.x, cy: CENTER.y, r: RADIUS }
    const rest = foremanFaceRest(facing)

    return (
        <span
            aria-hidden
            data-foreman-motion={moving ? '' : undefined}
            data-buddy-still={animated ? undefined : ''}
            className={cn('relative inline-flex shrink-0', className)}
            style={
                {
                    width,
                    height: foremanBallHeight(size, scale),
                    '--foreman-amp': motion.amp,
                    '--foreman-period': `${motion.period}s`,
                    '--foreman-sheen-period': `${motion.sheenPeriod}s`,
                } as CSSProperties
            }
        >
            <svg viewBox={viewBox} width="100%" height="100%" style={{ overflow: 'visible' }}>
                <defs>
                    <radialGradient id={`${uid}-body`} cx={CENTER.x - 12} cy={CENTER.y - 16} r={RADIUS * 1.55} gradientUnits="userSpaceOnUse">
                        {paint.stops.map(([offset, color]) => (
                            <stop key={offset} offset={offset} stopColor={color} />
                        ))}
                    </radialGradient>
                    <radialGradient id={`${uid}-bounce`} cx={CENTER.x + 16} cy={CENTER.y + 30} r={RADIUS * 0.8} gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor={paint.bounce} stopOpacity="0.5" />
                        <stop offset="100%" stopColor={paint.bounce} stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id={`${uid}-horizon`} x1="0" y1={CENTER.y + 4} x2="0" y2={FLOOR} gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor={paint.horizon} stopOpacity="0.85" />
                        <stop offset="100%" stopColor={paint.horizon} stopOpacity="0.05" />
                    </linearGradient>
                    <linearGradient id={`${uid}-gloss`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fff" stopOpacity={Math.min(1, material.topGloss + 0.3)} />
                        <stop offset="100%" stopColor="#fff" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id={`${uid}-outline`} x1="0" y1="0" x2="1" y2="1">
                        {material.outline.map((color, i) => (
                            <stop key={i} offset={i / Math.max(1, material.outline.length - 1)} stopColor={color} />
                        ))}
                    </linearGradient>
                    <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={material.sheen} stopOpacity="0" />
                        <stop offset="50%" stopColor={material.sheen} stopOpacity="0.55" />
                        <stop offset="100%" stopColor={material.sheen} stopOpacity="0" />
                    </linearGradient>
                    <radialGradient id={`${uid}-aura`}>
                        <stop offset="0%" stopColor={material.aura} stopOpacity="0.55" />
                        <stop offset="100%" stopColor={material.aura} stopOpacity="0" />
                    </radialGradient>
                    <radialGradient id={`${uid}-shadow`}>
                        <stop offset="0%" stopColor="#000" stopOpacity="0.55" />
                        <stop offset="100%" stopColor="#000" stopOpacity="0" />
                    </radialGradient>
                    <clipPath id={`${uid}-clip`}>
                        <circle {...sphere} />
                    </clipPath>
                    <filter id={`${uid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="1.6" />
                    </filter>
                </defs>

                {material.aura && <ellipse cx={CENTER.x} cy={FLOOR - 2} rx={RADIUS * 1.2} ry={RADIUS * 0.34} fill={`url(#${uid}-aura)`} />}
                <FromFloor className="foreman-ball-shadow">
                    <ellipse cx={CENTER.x} cy={FLOOR} rx={RADIUS * 0.72} ry={BELOW_FLOOR - 1} fill={`url(#${uid}-shadow)`} />
                </FromFloor>

                <FromFloor className="foreman-ball-body">
                    <circle {...sphere} fill={`url(#${uid}-body)`} />
                    <g clipPath={`url(#${uid}-clip)`}>
                        {paint.horizon && (
                            <path
                                d={`M${CENTER.x - RADIUS - 2} ${CENTER.y + 4} Q${CENTER.x} ${CENTER.y + 15} ${CENTER.x + RADIUS + 2} ${CENTER.y + 4} L${CENTER.x + RADIUS + 2} ${FLOOR + 2} L${CENTER.x - RADIUS - 2} ${FLOOR + 2} Z`}
                                fill={`url(#${uid}-horizon)`}
                            />
                        )}
                        <circle {...sphere} fill={`url(#${uid}-bounce)`} />
                        {animated && (
                            <g transform="skewX(-18)">
                                <rect className="foreman-buddy-sheen" x={CENTER.x - RADIUS - 24} y={CENTER.y - RADIUS} width={20} height={RADIUS * 2} fill={`url(#${uid}-sheen)`} />
                            </g>
                        )}
                        <g ref={faceRef} transform={foremanFacePose(rest.yaw, rest.pitch)}>
                            <g transform={`scale(${faceScale}) translate(${-BUDDY_FACE_CENTER} ${-EYE_Y})`}>
                                {face === 'plate' && <ForemanFacePlate uid={uid} y={EYE_Y} colors={material.plate} />}
                                <g ref={eyesRef} style={darkInk ? { filter: 'invert(1)' } : undefined}>
                                    <BuddyFace uid={uid} eyes={eyes} mouth="none" mood={state === 'thinking' ? 'working' : 'idle'} depth={EYE_Y / FACE_EYE_SHARE} light={material.eyeLight} lit={!small} tint={darkInk ? '#ffffff' : material.eyeTint} />
                                </g>
                            </g>
                        </g>
                        <ellipse cx={CENTER.x - 13} cy={CENTER.y - 24} rx={17} ry={8.5} transform={`rotate(-24 ${CENTER.x - 13} ${CENTER.y - 24})`} fill={`url(#${uid}-gloss)`} />
                    </g>
                    {material.neon && <circle {...sphere} fill="none" stroke={outline} strokeWidth={3} strokeOpacity={0.8} filter={`url(#${uid}-glow)`} />}
                    <circle {...sphere} fill="none" stroke={outline} strokeOpacity={material.neon ? 1 : 0.6} strokeWidth={material.neon ? 1.1 : 0.7} />
                </FromFloor>
            </svg>
        </span>
    )
}
