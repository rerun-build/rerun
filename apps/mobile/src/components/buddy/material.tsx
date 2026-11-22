import type { ImageSourcePropType } from 'react-native'
import { Defs, Ellipse, G, Image, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'

import type { Matrix } from '@/components/orb/orb-motion'

import { boxTop, roundedDiamond, type BoxGeometry } from './geometry'
import { CHROME_LIT, CHROME_SHADE, CHROME_TOP, chromeTone, shade, type BuddyMaterial, type ChromeTint } from './look'
import { svgTransform } from './wall-motion'

// The web wears a material through one SVG filter (noise, displacement, lighting) that
// react-native-svg does not draw. The phone keeps what it can: the walls' gradient of each material,
// glass that lets the floor show, a chrome studio, knitted stitches, the dents of clay, and the
// fibres of the soft ones as a picture laid over the block. No frayed hair, no lit bevel.

// Where a soft material's fibres are laid, in the units of the drawing: the whole block, small or
// large. Rendered from the web's filter by scripts/buddy-fibres.mjs.
const FIBRES_FRAME = { x: 0, y: 20, width: 100, height: 90 }
const FIBRES: Partial<Record<BuddyMaterial, ImageSourcePropType>> = {
    fluffy: require('../../../assets/images/buddy/fibres-fluffy.png'),
    plush: require('../../../assets/images/buddy/fibres-plush.png'),
    felt: require('../../../assets/images/buddy/fibres-felt.png'),
}

// Below this many points per unit of the drawing, fibres would only be noise, as on the web.
const FIBRES_FROM = 0.45

export function fibresOf(material: BuddyMaterial, detail: number) {
    return detail >= FIBRES_FROM ? FIBRES[material] : undefined
}

export function Fibres({ source }: { source: ImageSourcePropType }) {
    return <Image href={source} {...FIBRES_FRAME} preserveAspectRatio="none" />
}

export function rightWallPlane({ base, halfW, halfH, depth }: BoxGeometry): Matrix {
    return [1, -halfH / halfW, 0, 1, base.x, base.y - depth + halfH]
}

// The top's plane: a square of side halfW whose corners land on the diamond's.
export function topPlane({ base, halfW, halfH, depth }: BoxGeometry): Matrix {
    return [1, -halfH / halfW, 1, halfH / halfW, base.x - halfW, base.y - depth]
}

// Knitted stitches: two leaning loops per cell, lit from above.
export function KnitDefs({ uid, color }: { uid: string; color: string }) {
    return (
        <Defs>
            <LinearGradient id={`${uid}-stitch`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={shade(color, 0.32)} />
                <Stop offset="0.55" stopColor={color} />
                <Stop offset="1" stopColor={shade(color, -0.4)} />
            </LinearGradient>
            <Pattern id={`${uid}-knit`} width={4.4} height={4} patternUnits="userSpaceOnUse">
                <Rect width={4.4} height={4} fill="#000" fillOpacity={0.22} />
                <Ellipse cx={1.25} cy={2} rx={1.05} ry={2.15} transform="rotate(-30 1.25 2)" fill={`url(#${uid}-stitch)`} />
                <Ellipse cx={3.15} cy={2} rx={1.05} ry={2.15} transform="rotate(30 3.15 2)" fill={`url(#${uid}-stitch)`} />
            </Pattern>
        </Defs>
    )
}

export function KnitWalls({ uid, geometry, wall }: { uid: string; geometry: BoxGeometry; wall: Matrix }) {
    const { halfW, depth } = geometry
    const stitches = <Rect x={-3} y={-4} width={halfW + 6} height={depth + 8} fill={`url(#${uid}-knit)`} />
    return (
        <>
            <G transform={svgTransform(wall)}>{stitches}</G>
            <G transform={svgTransform(rightWallPlane(geometry))}>{stitches}</G>
        </>
    )
}

export function KnitTop({ uid, geometry }: { uid: string; geometry: BoxGeometry }) {
    const { halfW } = geometry
    return (
        <G transform={svgTransform(topPlane(geometry))}>
            <Rect x={-2} y={-2} width={halfW + 4} height={halfW + 4} fill={`url(#${uid}-knit)`} />
        </G>
    )
}

export function ClayDents({ geometry }: { geometry: BoxGeometry }) {
    const t = boxTop(geometry)
    return (
        <>
            {[4, 6.5, 9].map(r => (
                <Ellipse key={r} cx={t.x + 12} cy={t.y + 3} rx={r} ry={r * 0.5} fill="none" stroke="#000" strokeOpacity={0.08} strokeWidth={0.6} />
            ))}
        </>
    )
}

export function GlassGlint({ geometry }: { geometry: BoxGeometry }) {
    const t = boxTop(geometry)
    const x = t.x - geometry.halfW * 0.4
    const y = t.y - 2
    return <Ellipse cx={x} cy={y} rx={11} ry={2.6} transform={`rotate(-26 ${x} ${y})`} fill="#fff" fillOpacity={0.5} />
}

// The outline of the floor under a glass block, seen through it.
export function GlassFloor({ geometry }: { geometry: BoxGeometry }) {
    return <Path d={roundedDiamond(geometry.base, geometry.halfW, geometry.halfH, geometry.radius).d} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={0.7} />
}

export function ChromeTopDefs({ uid, tint }: { uid: string; tint: ChromeTint }) {
    return (
        <Defs>
            <LinearGradient id={`${uid}-top`} x1="0" y1="0" x2="0.3" y2="1">
                {CHROME_TOP.map(([offset, darkness]) => (
                    <Stop key={offset} offset={offset} stopColor={chromeTone(tint, darkness)} />
                ))}
            </LinearGradient>
            <RadialGradient id={`${uid}-glint`}>
                <Stop offset="0" stopColor="#fff" stopOpacity={1} />
                <Stop offset="0.55" stopColor="#fff" stopOpacity={0.55} />
                <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </RadialGradient>
        </Defs>
    )
}

// The softboxes of the studio, caught on the top.
export function ChromeGlints({ uid, geometry }: { uid: string; geometry: BoxGeometry }) {
    const t = boxTop(geometry)
    const { halfW, halfH } = geometry
    const sx = t.x - halfW * 0.24
    const sy = t.y - halfH * 0.36
    const gx = t.x + halfW * 0.42
    const gy = t.y + halfH * 0.05
    return (
        <>
            <Ellipse cx={sx} cy={sy} rx={halfW * 0.52} ry={3.4} transform={`rotate(-26.6 ${sx} ${sy})`} fill={`url(#${uid}-glint)`} />
            <Ellipse cx={gx} cy={gy} rx={halfW * 0.16} ry={1.6} transform={`rotate(26.6 ${gx} ${gy})`} fill={`url(#${uid}-glint)`} opacity={0.7} />
        </>
    )
}

// Both walls of the mirror, each in its own plane: the studio, then its softboxes.
export function ChromeWalls({ uid, geometry, tint, wall }: { uid: string; geometry: BoxGeometry; tint: ChromeTint; wall: Matrix }) {
    const { halfW, depth } = geometry
    const bar = (x: number, width: number, opacity: number) => <Rect x={x} y={-4} width={width} height={depth + 8} fill={`url(#${uid}-softbox)`} opacity={opacity} />
    const studio = (side: 'left' | 'right') => <Rect x={-3} y={-4} width={halfW + 6} height={depth + 8} fill={`url(#${uid}-env-${side})`} />
    return (
        <>
            <Defs>
                {(['left', 'right'] as const).map(side => (
                    <LinearGradient key={side} id={`${uid}-env-${side}`} x1="0" y1="-1" x2="0" y2={depth + 1} gradientUnits="userSpaceOnUse">
                        {(side === 'left' ? CHROME_LIT : CHROME_SHADE).map(([offset, darkness]) => (
                            <Stop key={offset} offset={offset} stopColor={chromeTone(tint, darkness)} />
                        ))}
                    </LinearGradient>
                ))}
                <LinearGradient id={`${uid}-softbox`} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor="#fff" stopOpacity={0} />
                    <Stop offset="0.5" stopColor="#fff" stopOpacity={0.95} />
                    <Stop offset="1" stopColor="#fff" stopOpacity={0} />
                </LinearGradient>
            </Defs>
            <G transform={svgTransform(wall)}>
                {studio('left')}
                {bar(halfW * 0.2, 7, 0.9)}
                {bar(halfW * 0.66, 2.4, 0.55)}
            </G>
            <G transform={svgTransform(rightWallPlane(geometry))}>
                {studio('right')}
                {bar(-1.5, 3.4, 0.85)}
                {bar(halfW * 0.55, 5, 0.18)}
            </G>
        </>
    )
}
