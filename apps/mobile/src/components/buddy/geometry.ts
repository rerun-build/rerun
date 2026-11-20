import type { Matrix } from '@/components/orb/orb-motion'

import { BUDDY_HEIGHT_RATIO } from './look'

export type Point = { x: number; y: number }

export type BoxGeometry = {
    // Centre of the bottom diamond, the point that sits on the floor.
    base: Point
    halfW: number
    halfH: number
    depth: number
    radius: number
}

const HALF_W = 40
export const BUDDY_GEOMETRY: BoxGeometry = { base: { x: 50, y: 86 }, halfW: HALF_W, halfH: HALF_W / 2, depth: HALF_W * 2 * BUDDY_HEIGHT_RATIO, radius: 9 }

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

const fmt = (p: Point) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

// The block seen from the front, top excluded: its walls down to the floor. One outline with no
// overlap, since react-native-svg clips with evenodd whatever the rule says.
export function wallsOutline({ base, halfW, halfH, depth, radius }: BoxGeometry) {
    const corners = [
        { x: base.x + halfW, y: base.y },
        { x: base.x, y: base.y + halfH },
        { x: base.x - halfW, y: base.y },
    ]
    const t = radius / Math.hypot(halfW, halfH)
    const top = { x: base.x, y: base.y - halfH }
    const bottom = corners[1]
    const right = { from: lerp(corners[0], top, t), corner: corners[0], to: lerp(corners[0], bottom, t) }
    const low = { from: lerp(bottom, corners[0], t), corner: bottom, to: lerp(bottom, corners[2], t) }
    const left = { from: lerp(corners[2], bottom, t), corner: corners[2], to: lerp(corners[2], top, t) }
    const rightSide = { x: (right.from.x + 2 * right.corner.x + right.to.x) / 4, y: base.y }
    const leftSide = { x: (left.from.x + 2 * left.corner.x + left.to.x) / 4, y: base.y }
    const ceiling = base.y - depth * 2
    return [
        `M${leftSide.x.toFixed(2)} ${ceiling.toFixed(2)} L${rightSide.x.toFixed(2)} ${ceiling.toFixed(2)} L${fmt(rightSide)}`,
        `Q${fmt(mid(right.corner, right.to))} ${fmt(right.to)}`,
        `L${fmt(low.from)} Q${fmt(low.corner)} ${fmt(low.to)}`,
        `L${fmt(left.from)} Q${fmt(mid(left.from, left.corner))} ${fmt(leftSide)} Z`,
    ].join(' ')
}

export function boxTop(geometry: BoxGeometry): Point {
    return { x: geometry.base.x, y: geometry.base.y - geometry.depth }
}

// The front-left wall's own plane: x runs along its bottom edge (0…halfW), y down from its top
// edge (0…depth). Anything drawn inside reads as painted on that wall.
export function leftWallPlane({ base, halfW, halfH, depth }: BoxGeometry): Matrix {
    return [1, halfH / halfW, 0, 1, base.x - halfW, base.y - depth]
}
