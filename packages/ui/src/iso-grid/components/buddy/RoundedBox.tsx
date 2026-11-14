import type { ReactNode } from 'react'
import { shade } from './buddy-look'

export type Point = { x: number; y: number }

export type BoxGeometry = {
    base: Point
    halfW: number
    halfH: number
    depth: number
    radius: number
}

function lerp(a: Point, b: Point, t: number): Point {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

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
    left?: ReactNode
    onTop?: ReactNode
}

const STRETCH_HEADROOM = 1

export function GrowsFrom({ y, painted, children }: { y: number; painted?: boolean; children: ReactNode }) {
    return (
        <g transform={`translate(0 ${y})`}>
            <g className={painted ? 'iso-buddy-wall iso-buddy-painted' : 'iso-buddy-wall'}>
                <g transform={`translate(0 ${-y})`}>{children}</g>
            </g>
        </g>
    )
}

export function RoundedBox({ uid, geometry, color, top, topLight, rim, left, onTop }: RoundedBoxProps) {
    const { halfW, halfH, depth, radius } = geometry
    const topCenter = boxTop(geometry)
    const topShape = roundedDiamond(topCenter, halfW, halfH, radius)
    const bottomShape = roundedDiamond(geometry.base, halfW, halfH, radius)
    const x0 = topCenter.x - halfW + topShape.sideInset
    const x1 = topCenter.x + halfW - topShape.sideInset
    const fill = { x: x0 - 2, y: topCenter.y, width: x1 - x0 + 4, height: depth + halfH + 2 }
    const headroom = depth * STRETCH_HEADROOM

    return (
        <>
            <defs>
                <linearGradient id={`${uid}-side`} x1={x0} x2={x1} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" style={{ stopColor: shade(color, -0.1) }} />
                    <stop offset="44%" style={{ stopColor: shade(color, -0.26) }} />
                    <stop offset="56%" style={{ stopColor: shade(color, -0.46) }} />
                    <stop offset="100%" style={{ stopColor: shade(color, -0.6) }} />
                </linearGradient>
                <linearGradient id={`${uid}-side-shade`} x1="0" y1={topCenter.y} x2="0" y2={geometry.base.y + halfH} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#000" stopOpacity="0" />
                    <stop offset="100%" stopColor="#000" stopOpacity="0.35" />
                </linearGradient>
                <radialGradient id={`${uid}-top`} cx="42%" cy="35%" r="75%">
                    <stop offset="0%" style={{ stopColor: shade(top, topLight) }} />
                    <stop offset="100%" style={{ stopColor: shade(top, -0.04) }} />
                </radialGradient>
                <clipPath id={`${uid}-top-clip`}>
                    <path d={topShape.d} />
                </clipPath>
                <clipPath id={`${uid}-body-clip`}>
                    <path d={bottomShape.d} />
                    <rect x={x0} y={topCenter.y - headroom} width={x1 - x0} height={depth + headroom} />
                </clipPath>
                <filter id={`${uid}-rim`} x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="1.2" />
                </filter>
            </defs>

            <g clipPath={`url(#${uid}-body-clip)`}>
                <GrowsFrom y={geometry.base.y}>
                    <rect {...fill} fill={`url(#${uid}-side)`} />
                    <rect {...fill} fill={`url(#${uid}-side-shade)`} />
                </GrowsFrom>
                {left}
            </g>

            <g className="iso-buddy-top">
                <path d={topShape.d} fill={`url(#${uid}-top)`} />
                <g clipPath={`url(#${uid}-top-clip)`}>
                    <path d={topShape.d} fill="none" stroke="#fff" strokeOpacity={rim} strokeWidth={3} filter={`url(#${uid}-rim)`} transform="translate(0 1.4)" />
                    {onTop}
                </g>
                <path d={topShape.d} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.7} />
            </g>
        </>
    )
}
