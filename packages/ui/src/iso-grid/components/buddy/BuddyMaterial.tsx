import type { ReactNode } from 'react'
import type { BuddyMaterial } from '../../types'
import { shade } from './buddy-look'
import type { BoxGeometry } from './RoundedBox'

// What a buddy is made of. The block is drawn with its usual shading, then one SVG filter turns it
// into fur, felt, clay, rubber, glass or chrome: noise that displaces the outline into hairs, fibres
// lit by a distant light, a bevel that catches a specular. The face is drawn after the filter and
// stays crisp. `classic` has no filter: a buddy nobody dressed costs nothing more.

// How long the hair of a soft material is, how deep its fibres.
const SOFTNESS = 0.7

type Stop = [offset: number, amount: number]

// The walls' gradient, from the lit front-left wall to the right one in shade, as shades of the
// body's colour. Chrome draws a studio instead.
export const MATERIAL_SIDE: Record<BuddyMaterial, Stop[]> = {
    classic: [[0, -0.1], [44, -0.26], [56, -0.46], [100, -0.6]],
    fluffy: [[0, 0.04], [44, -0.08], [56, -0.2], [100, -0.3]],
    plush: [[0, 0], [44, -0.12], [56, -0.26], [100, -0.38]],
    felt: [[0, -0.04], [44, -0.16], [56, -0.3], [100, -0.42]],
    knit: [[0, -0.02], [44, -0.14], [56, -0.3], [100, -0.42]],
    clay: [[0, 0.02], [40, -0.1], [60, -0.28], [100, -0.4]],
    rubber: [[0, -0.12], [44, -0.24], [56, -0.42], [100, -0.55]],
    glass: [[0, 0.5], [40, 0.25], [60, 0.05], [100, -0.15]],
    chrome: [[0, 0], [100, 0]],
}

// Soft and squeezable materials round their corners more.
export const MATERIAL_RADIUS: Partial<Record<BuddyMaterial, number>> = { fluffy: 14, plush: 12, clay: 15, rubber: 13, felt: 11 }

const FILTER_REGION = { filterUnits: 'userSpaceOnUse', x: -6, y: 24, width: 112, height: 100, colorInterpolationFilters: 'sRGB' } as const

// Height from a blurred silhouette: a rounded edge that catches the light.
function Bevel({ blur, surface, constant, exponent, add, elevation = 50 }: { blur: number; surface: number; constant: number; exponent: number; add: number; elevation?: number }) {
    return (
        <>
            <feGaussianBlur in="SourceAlpha" stdDeviation={blur} result="bevel-height" />
            <feSpecularLighting in="bevel-height" surfaceScale={surface} specularConstant={constant} specularExponent={exponent} lightingColor="#fff" result="bevel-light">
                <feDistantLight azimuth={225} elevation={elevation} />
            </feSpecularLighting>
            <feComposite in="bevel-light" in2="SourceAlpha" operator="in" result="bevel-spec" />
            <feComposite in="body" in2="bevel-spec" operator="arithmetic" k2={1} k3={add} result="body" />
        </>
    )
}

// Lights a noise like a surface and multiplies the body with it: fibres, felt, grain.
function Fibres({ frequency, octaves, surface, seed, diffuse }: { frequency: string; octaves: number; surface: number; seed: number; diffuse: number }) {
    return (
        <>
            <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves={octaves} seed={seed} result="fibre-noise" />
            <feDiffuseLighting in="fibre-noise" surfaceScale={surface} diffuseConstant={diffuse} lightingColor="#fff" result="fibre-light">
                <feDistantLight azimuth={225} elevation={58} />
            </feDiffuseLighting>
            <feComposite in="body" in2="fibre-light" operator="arithmetic" k1={1} result="body" />
        </>
    )
}

// The inner rim of a soft surface catches more light than its middle: velvet, short fur.
function Sheen({ width, opacity }: { width: number; opacity: number }) {
    return (
        <>
            <feGaussianBlur in="SourceAlpha" stdDeviation={width} result="sheen-blur" />
            <feComposite in="SourceAlpha" in2="sheen-blur" operator="arithmetic" k2={1} k3={-1} result="sheen-edge" />
            <feFlood floodColor="#fff" floodOpacity={opacity} />
            <feComposite in2="sheen-edge" operator="in" result="sheen" />
            <feComposite in="sheen" in2="body" operator="over" result="body" />
        </>
    )
}

// Noise that moves the pixels of the body: large and slow, the outline goes lumpy; fine and strong,
// it frays into hairs.
function Displace({ frequency, scale, seed, octaves = 2 }: { frequency: string; scale: number; seed: number; octaves?: number }) {
    return (
        <>
            <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves={octaves} seed={seed} result={`displace-${seed}`} />
            <feDisplacementMap in="body" in2={`displace-${seed}`} scale={scale} xChannelSelector="R" yChannelSelector="G" result="body" />
        </>
    )
}

function materialSteps(material: Exclude<BuddyMaterial, 'classic'>, relief: number, fibres: boolean): ReactNode {
    const k = SOFTNESS
    switch (material) {
        case 'fluffy':
            return (
                <>
                    <Displace frequency="0.07" scale={6 * k} seed={4} />
                    <Displace frequency="0.7" scale={8 * k} seed={8} />
                    {fibres && <Fibres frequency="1.1 0.45" octaves={2} surface={1.05 * relief} seed={11} diffuse={1.1} />}
                    <feGaussianBlur in="body" stdDeviation={0.35} result="body" />
                    <Displace frequency="1.5" scale={3.2 * k} seed={13} octaves={1} />
                    <Sheen width={3.2} opacity={0.22} />
                </>
            )
        case 'plush':
            return (
                <>
                    <Displace frequency="1.8" scale={2.2 * k} seed={8} />
                    {fibres && <Fibres frequency="2.2 1" octaves={2} surface={0.55 * relief} seed={11} diffuse={1.06} />}
                    <feGaussianBlur in="body" stdDeviation={0.2} result="body" />
                    <Sheen width={2.6} opacity={0.32} />
                </>
            )
        case 'felt':
            return (
                <>
                    <Displace frequency="2" scale={1.2 * k} seed={6} octaves={1} />
                    {fibres && <Fibres frequency="0.7" octaves={4} surface={(0.6 * k + 0.35) * relief} seed={5} diffuse={1.06} />}
                </>
            )
        case 'knit':
            return (
                <>
                    <Displace frequency="2.4" scale={1.3 * k} seed={6} octaves={1} />
                    {fibres && <Fibres frequency="3 1.4" octaves={2} surface={0.8 * relief} seed={9} diffuse={1.08} />}
                </>
            )
        case 'clay':
            return (
                <>
                    <Displace frequency="0.05" scale={3} seed={3} />
                    <feGaussianBlur in="SourceAlpha" stdDeviation={2.6} result="clay-round" />
                    <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves={2} seed={6} result="clay-dents" />
                    <feComposite in="clay-round" in2="clay-dents" operator="arithmetic" k2={1} k3={0.22} result="clay-height" />
                    <feSpecularLighting in="clay-height" surfaceScale={3.2 * relief} specularConstant={0.5} specularExponent={9} lightingColor="#fff" result="clay-light">
                        <feDistantLight azimuth={225} elevation={46} />
                    </feSpecularLighting>
                    <feComposite in="clay-light" in2="SourceAlpha" operator="in" result="clay-spec" />
                    <feComposite in="body" in2="clay-spec" operator="arithmetic" k2={1} k3={0.55} result="body" />
                </>
            )
        case 'rubber':
            return (
                <>
                    {fibres && <Fibres frequency="2.4" octaves={1} surface={0.25 * relief} seed={3} diffuse={1.04} />}
                    <Bevel blur={2.6} surface={3.2 * relief} constant={0.5} exponent={11} add={0.42} />
                </>
            )
        case 'glass':
            return (
                <>
                    <Sheen width={1.6} opacity={0.55} />
                    <Bevel blur={1.5} surface={5 * relief} constant={1.4} exponent={38} add={1} elevation={42} />
                </>
            )
        case 'chrome':
            return <Bevel blur={0.9} surface={5 * relief} constant={2} exponent={80} add={1} elevation={38} />
    }
}

// `detail` is how many CSS pixels one unit of the drawing takes. Lighting reads the slope of the
// noise pixel by pixel: drawn small, the slope gets so steep the surface turns black, so the relief
// flattens with the size, and the fibres go once they would only be noise.
export function MaterialFilter({ id, material, detail }: { id: string; material: Exclude<BuddyMaterial, 'classic'>; detail: number }) {
    const relief = Math.min(1, detail) ** 2
    const fibres = detail >= 0.45
    return (
        <filter id={id} {...FILTER_REGION}>
            <feOffset in="SourceGraphic" dx={0} dy={0} result="body" />
            {materialSteps(material, relief, fibres)}
            <feComposite in="body" in2="body" operator="over" />
        </filter>
    )
}

// The right wall's plane, like leftWallPlane: x along its bottom edge from the front corner, y down.
export function rightWallPlane({ base, halfW, halfH, depth }: BoxGeometry) {
    return `translate(${base.x} ${base.y - depth + halfH}) matrix(1 ${-halfH / halfW} 0 1 0 0)`
}

// The top's plane: a square of side halfW whose corners land on the diamond's.
export function topPlane(geometry: BoxGeometry) {
    const { base, halfW, halfH, depth } = geometry
    return `translate(${base.x - halfW} ${base.y - depth}) matrix(1 ${-halfH / halfW} 1 ${halfH / halfW} 0 0)`
}

// Knitted stitches: two leaning loops per cell, lit from above.
export function KnitDefs({ uid, color }: { uid: string; color: string }) {
    return (
        <>
            <pattern id={`${uid}-knit`} width={4.4} height={4} patternUnits="userSpaceOnUse">
                <rect width={4.4} height={4} fill="#000" fillOpacity={0.22} />
                <ellipse cx={1.25} cy={2} rx={1.05} ry={2.15} transform="rotate(-30 1.25 2)" fill={`url(#${uid}-stitch)`} />
                <ellipse cx={3.15} cy={2} rx={1.05} ry={2.15} transform="rotate(30 3.15 2)" fill={`url(#${uid}-stitch)`} />
            </pattern>
            <linearGradient id={`${uid}-stitch`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: shade(color, 0.32) }} />
                <stop offset="55%" style={{ stopColor: color }} />
                <stop offset="100%" style={{ stopColor: shade(color, -0.4) }} />
            </linearGradient>
        </>
    )
}

// Chrome is a mirror: almost no colour of its own, it shows a studio around it, a bright ceiling, a
// dark horizon, the floor and two softboxes. Each stop is how dark the reflection is there.
const CHROME_LIT: Stop[] = [[0, 0], [26, 0.08], [38, 0.45], [42, 0.97], [62, 0.9], [100, 0.68]]
const CHROME_SHADE: Stop[] = [[0, 0.28], [32, 0.5], [40, 0.98], [70, 0.94], [100, 0.84]]
const CHROME_TOP: Stop[] = [[0, 0], [28, 0.06], [43, 0.3], [47, 0.88], [72, 0.78], [100, 0.4]]

// The colour that tints the mirror, and how much of it: the coworker's colour only tints it, a state
// tints it harder so the board still reads amber, red or cyan.
export type ChromeTint = { color: string; share: number }

function chromeTone({ color, share }: ChromeTint, darkness: number) {
    return `color-mix(in srgb, color-mix(in srgb, #ffffff, #08090b ${Math.round(darkness * 100)}%), ${color} ${share}%)`
}

export function ChromeDefs({ uid, tint, depth }: { uid: string; tint: ChromeTint; depth: number }) {
    return (
        <>
            <linearGradient id={`${uid}-top`} x1="0" y1="0" x2="0.3" y2="1">
                {CHROME_TOP.map(([offset, darkness]) => (
                    <stop key={offset} offset={`${offset}%`} style={{ stopColor: chromeTone(tint, darkness) }} />
                ))}
            </linearGradient>
            {(['left', 'right'] as const).map(wall => (
                <linearGradient key={wall} id={`${uid}-env-${wall}`} x1="0" y1="-1" x2="0" y2={depth + 1} gradientUnits="userSpaceOnUse">
                    {(wall === 'left' ? CHROME_LIT : CHROME_SHADE).map(([offset, darkness]) => (
                        <stop key={offset} offset={`${offset}%`} style={{ stopColor: chromeTone(tint, darkness) }} />
                    ))}
                </linearGradient>
            ))}
            <linearGradient id={`${uid}-softbox`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fff" stopOpacity="0" />
                <stop offset="50%" stopColor="#fff" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={`${uid}-glint`}>
                <stop offset="0%" stopColor="#fff" stopOpacity="1" />
                <stop offset="55%" stopColor="#fff" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
        </>
    )
}

// One wall of the mirror, drawn in its own plane: the studio, then its softboxes.
export function ChromeWall({ uid, side, geometry }: { uid: string; side: 'left' | 'right'; geometry: BoxGeometry }) {
    const { halfW, depth } = geometry
    const bar = (x: number, width: number, opacity: number) => <rect x={x} y={-4} width={width} height={depth + 8} fill={`url(#${uid}-softbox)`} opacity={opacity} />
    return (
        <>
            <rect x={-3} y={-4} width={halfW + 6} height={depth + 8} fill={`url(#${uid}-env-${side})`} />
            {side === 'left' ? (
                <>
                    {bar(halfW * 0.2, 7, 0.9)}
                    {bar(halfW * 0.66, 2.4, 0.55)}
                </>
            ) : (
                <>
                    {bar(-1.5, 3.4, 0.85)}
                    {bar(halfW * 0.55, 5, 0.18)}
                </>
            )}
        </>
    )
}

// The softboxes of the studio, caught on the top.
export function ChromeTop({ uid, geometry }: { uid: string; geometry: BoxGeometry }) {
    const { base, halfW, halfH, depth } = geometry
    const t = { x: base.x, y: base.y - depth }
    const sx = t.x - halfW * 0.24
    const sy = t.y - halfH * 0.36
    const gx = t.x + halfW * 0.42
    const gy = t.y + halfH * 0.05
    return (
        <>
            <ellipse cx={sx} cy={sy} rx={halfW * 0.52} ry={3.4} transform={`rotate(-26.6 ${sx} ${sy})`} fill={`url(#${uid}-glint)`} />
            <ellipse cx={gx} cy={gy} rx={halfW * 0.16} ry={1.6} transform={`rotate(26.6 ${gx} ${gy})`} fill={`url(#${uid}-glint)`} opacity={0.7} />
        </>
    )
}
