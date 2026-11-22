import type { ReactNode } from 'react'
import type { BuddyMaterial } from '../../types'
import { shade } from './buddy-look'
import { ChromeDefs, ChromeTop, ChromeWall, KnitDefs, MATERIAL_SIDE, MaterialFilter, rightWallPlane, topPlane, type ChromeTint } from './BuddyMaterial'

export type Point = { x: number; y: number }

export type BoxGeometry = {
    // Centre of the bottom diamond, the point that sits on the floor.
    base: Point
    halfW: number
    halfH: number
    depth: number
    radius: number
}

function lerp(a: Point, b: Point, t: number): Point {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

// A diamond whose four corners are rounded by quadratic curves. `sideInset` is how far its widest
// point stands inside the sharp corner, which is where the rounded side walls start.
export function roundedDiamond(center: Point, halfW: number, halfH: number, radius: number) {
    const corners = [
        { x: center.x, y: center.y - halfH },
        { x: center.x + halfW, y: center.y },
        { x: center.x, y: center.y + halfH },
        { x: center.x - halfW, y: center.y },
    ]
    const t = radius / Math.hypot(halfW, halfH)
    const parts = corners.map((corner, i) => ({ from: lerp(corner, corners[(i + 3) % 4], t), corner, to: lerp(corner, corners[(i + 1) % 4], t) }))
    const fmt = (p: Point) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    let d = `M${fmt(parts[0].from)}`
    parts.forEach((part, i) => {
        if (i > 0) d += ` L${fmt(part.from)}`
        d += ` Q${fmt(part.corner)} ${fmt(part.to)}`
    })
    return { d: `${d} Z`, sideInset: (parts[3].from.x - parts[3].corner.x) / 2 }
}

export function boxTop(geometry: BoxGeometry): Point {
    return { x: geometry.base.x, y: geometry.base.y - geometry.depth }
}

// The front-left wall's own plane: x runs along its bottom edge (0…halfW), y down from its top
// edge (0…depth). Anything drawn inside reads as painted on that wall.
export function leftWallPlane({ base, halfW, halfH, depth }: BoxGeometry) {
    return `translate(${base.x - halfW} ${base.y - depth}) matrix(1 ${halfH / halfW} 0 1 0 0)`
}

type RoundedBoxProps = {
    uid: string
    geometry: BoxGeometry
    color: string
    top: string
    topLight: number
    rim: number
    material?: BuddyMaterial
    // How many CSS pixels one unit of the drawing takes: a material's relief flattens when drawn small.
    detail?: number
    // What a chrome block reflects of its colour.
    chromeTint: ChromeTint
    // Painted on the front-left wall, after the material: a face stays crisp on fur.
    left?: ReactNode
    onTop?: ReactNode
}

// How far above its resting height the top may rise, as a share of the depth.
const STRETCH_HEADROOM = 1

// Scales its children's height from the horizontal line `y`, the way a wall grows from the floor.
// The `iso-buddy-wall` animation scales around the origin, so the line is brought there first.
// `painted` marks what is drawn on the wall rather than the wall itself: a selected buddy's wall
// grows taller, what is painted on it keeps its size and stays in the middle.
export function GrowsFrom({ y, painted, children }: { y: number; painted?: boolean; children: ReactNode }) {
    return (
        <g transform={`translate(0 ${y})`}>
            <g className={painted ? 'iso-buddy-wall iso-buddy-painted' : 'iso-buddy-wall'}>
                <g transform={`translate(0 ${-y})`}>{children}</g>
            </g>
        </g>
    )
}

// A thick, soft block: the rounded diamond swept down. The side is one surface, and the fold
// between its two halves is a gradient, the way light turns around a rounded edge. When it moves,
// only its top does (`iso-buddy-top`) and the walls stretch under it: the bottom diamond stays
// where it stands on the floor. A material other than classic runs the walls and the top through
// one filter.
export function RoundedBox({ uid, geometry, color, top, topLight, rim, material = 'classic', detail = 1, chromeTint, left, onTop }: RoundedBoxProps) {
    const { halfW, halfH, depth, radius } = geometry
    const topCenter = boxTop(geometry)
    const topShape = roundedDiamond(topCenter, halfW, halfH, radius)
    const bottomShape = roundedDiamond(geometry.base, halfW, halfH, radius)
    const x0 = topCenter.x - halfW + topShape.sideInset
    const x1 = topCenter.x + halfW - topShape.sideInset
    const fill = { x: x0 - 2, y: topCenter.y, width: x1 - x0 + 4, height: depth + halfH + 2 }
    const headroom = depth * STRETCH_HEADROOM
    const classic = material === 'classic'
    const glass = material === 'glass'
    const chrome = material === 'chrome'
    const knit = material === 'knit'
    const knitWall = <rect x={-3} y={-4} width={halfW + 6} height={depth + 8} fill={`url(#${uid}-knit)`} />

    return (
        <>
            <defs>
                <linearGradient id={`${uid}-side`} x1={x0} x2={x1} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                    {MATERIAL_SIDE[material].map(([offset, amount]) => (
                        <stop key={offset} offset={`${offset}%`} style={{ stopColor: shade(color, amount) }} />
                    ))}
                </linearGradient>
                <linearGradient id={`${uid}-side-shade`} x1="0" y1={topCenter.y} x2="0" y2={geometry.base.y + halfH} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#000" stopOpacity="0" />
                    <stop offset="100%" stopColor="#000" stopOpacity="0.35" />
                </linearGradient>
                {chrome ? (
                    <ChromeDefs uid={uid} tint={chromeTint} depth={depth} />
                ) : (
                    <radialGradient id={`${uid}-top`} cx="42%" cy="35%" r="75%">
                        <stop offset="0%" style={{ stopColor: shade(top, glass ? 0.5 : topLight) }} />
                        <stop offset="100%" style={{ stopColor: shade(top, glass ? 0.1 : -0.04) }} />
                    </radialGradient>
                )}
                <clipPath id={`${uid}-top-clip`}>
                    <path d={topShape.d} />
                </clipPath>
                <clipPath id={`${uid}-body-clip`}>
                    <path d={bottomShape.d} />
                    <rect x={x0} y={topCenter.y - headroom} width={x1 - x0} height={depth + headroom} />
                </clipPath>
                {classic ? (
                    <filter id={`${uid}-rim`} x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="1.2" />
                    </filter>
                ) : (
                    <MaterialFilter id={`${uid}-material`} material={material} detail={detail} />
                )}
                {knit && <KnitDefs uid={uid} color={color} />}
            </defs>

            {glass && <path d={bottomShape.d} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={0.7} />}

            <g filter={classic ? undefined : `url(#${uid}-material)`}>
                <g clipPath={`url(#${uid}-body-clip)`}>
                    <GrowsFrom y={geometry.base.y}>
                        {chrome ? (
                            <>
                                <g transform={leftWallPlane(geometry)}>
                                    <ChromeWall uid={uid} side="left" geometry={geometry} />
                                </g>
                                <g transform={rightWallPlane(geometry)}>
                                    <ChromeWall uid={uid} side="right" geometry={geometry} />
                                </g>
                            </>
                        ) : (
                            <>
                                <rect {...fill} fill={`url(#${uid}-side)`} fillOpacity={glass ? 0.62 : 1} />
                                <rect {...fill} fill={`url(#${uid}-side-shade)`} fillOpacity={glass ? 0.4 : 1} />
                            </>
                        )}
                    </GrowsFrom>
                    {knit && (
                        <>
                            <g transform={leftWallPlane(geometry)}>
                                <GrowsFrom y={depth}>{knitWall}</GrowsFrom>
                            </g>
                            <g transform={rightWallPlane(geometry)}>
                                <GrowsFrom y={depth}>{knitWall}</GrowsFrom>
                            </g>
                        </>
                    )}
                </g>

                <g className="iso-buddy-top">
                    <path d={topShape.d} fill={`url(#${uid}-top)`} fillOpacity={glass ? 0.72 : 1} />
                    <g clipPath={`url(#${uid}-top-clip)`}>
                        {classic && <path d={topShape.d} fill="none" stroke="#fff" strokeOpacity={rim} strokeWidth={3} filter={`url(#${uid}-rim)`} transform="translate(0 1.4)" />}
                        {knit && (
                            <g transform={topPlane(geometry)}>
                                <rect x={-2} y={-2} width={halfW + 4} height={halfW + 4} fill={`url(#${uid}-knit)`} />
                            </g>
                        )}
                        {material === 'clay' && [4, 6.5, 9].map(r => <ellipse key={r} cx={topCenter.x + 12} cy={topCenter.y + 3} rx={r} ry={r * 0.5} fill="none" stroke="#000" strokeOpacity={0.08} strokeWidth={0.6} />)}
                        {chrome && <ChromeTop uid={uid} geometry={geometry} />}
                        {glass && <ellipse cx={topCenter.x - halfW * 0.4} cy={topCenter.y - 2} rx={11} ry={2.6} transform={`rotate(-26 ${topCenter.x - halfW * 0.4} ${topCenter.y - 2})`} fill="#fff" fillOpacity={0.5} />}
                        {onTop}
                    </g>
                    {classic && <path d={topShape.d} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.7} />}
                    {chrome && <path d={topShape.d} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={0.55} />}
                </g>
            </g>

            {left && <g clipPath={`url(#${uid}-body-clip)`}>{left}</g>}
        </>
    )
}
