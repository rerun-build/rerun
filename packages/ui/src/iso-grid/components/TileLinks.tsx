'use client'

import { memo, useMemo } from 'react'
import { ISO_DIM_MS, ISO_DIM_OPACITY, TILE_H, TILE_W, hashUnit, isPlaced } from '../iso'
import { BELT_WIDTH, routeTileLinks, type AxisPoint, type RoutedLink, type RoutedTile } from '../link-routes'
import type { Container, Tile, TileLink, WorldOffset } from '../types'

const HALF_W = TILE_W / 2
const HALF_H = TILE_H / 2

const DASH = '6 16'
const DASH_PERIOD = 22

const DEFAULT_COLOR = '#38bdf8'

const CABLE_TAIL_RATIO = 0.16
const CABLE_TAIL_MIN = 8
const CABLE_TAIL_MAX = 26
const CABLE_CORNER_RADIUS = 5
export const CABLE_DRAW_MS = 420

type TileLinksProps = {
    tiles: Tile[]
    liveLinks: TileLink[]
    containers: Container[]
    worldOffset: WorldOffset
    svgHalfW: number
    svgHalfH: number
}

type Link = {
    id: string
    key: string
    source: Tile
    target: Tile
    variant: 'beam' | 'cable' | 'trace' | 'belt'
    appearDelay: number
    color?: string
    still?: boolean
    chevrons?: boolean
}

function axisToWorld(point: AxisPoint, worldOffset: WorldOffset) {
    return {
        x: (point.u - point.v) * HALF_W + HALF_W + worldOffset.left,
        y: (point.u + point.v) * HALF_H + worldOffset.top,
    }
}

function cableTiming(id: string) {
    const travel = 1.7 + hashUnit(id, 1) * 1.5
    const rest = 0.5 + hashUnit(id, 2) * 2
    const period = travel + rest
    return { period, travelRatio: travel / period, phase: hashUnit(id, 3) * period }
}

function traceTiming(id: string) {
    const travel = 3.2 + hashUnit(id, 4) * 2.6
    const rest = 0.9 + hashUnit(id, 5) * 2.2
    const period = travel + rest
    return { period, travelRatio: travel / period, phase: hashUnit(id, 6) * period }
}

const BELT_SLATS = '1.4 6'

const TRACE_TRAIL = [
    { share: 0.12, opacity: 0.85, width: 1.5 },
    { share: 0.3, opacity: 0.32, width: 1.2 },
    { share: 0.55, opacity: 0.1, width: 1 },
]

type ScreenPoint = { x: number; y: number }
type Route = { link: Link; points: ScreenPoint[]; d: string; length: number }

function distance(a: ScreenPoint, b: ScreenPoint) {
    return Math.hypot(b.x - a.x, b.y - a.y)
}

function polylineLength(points: ScreenPoint[]) {
    let total = 0
    for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
    return total
}

function towards(from: ScreenPoint, to: ScreenPoint, length: number): ScreenPoint {
    const d = distance(from, to) || 1
    return { x: from.x + ((to.x - from.x) / d) * length, y: from.y + ((to.y - from.y) / d) * length }
}

function cometPath(points: ScreenPoint[], overshoot: number) {
    const all = [
        towards(points[0], points[1], -overshoot),
        ...points,
        towards(points[points.length - 1], points[points.length - 2], -overshoot),
    ]
    const at = (p: ScreenPoint) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    let d = `M ${at(all[0])}`
    for (let i = 1; i < all.length - 1; i++) {
        const radius = Math.min(CABLE_CORNER_RADIUS, distance(all[i - 1], all[i]) / 2, distance(all[i], all[i + 1]) / 2)
        d += ` L ${at(towards(all[i], all[i - 1], radius))} Q ${at(all[i])} ${at(towards(all[i], all[i + 1], radius))}`
    }
    return `${d} L ${at(all[all.length - 1])}`
}

const CHEVRON_STEP = 44
const CHEVRON_FIRST = 22
const CHEVRON_TAIL = 6
const CHEVRON_ANGLE = (40 * Math.PI) / 180

function chevronPoints(points: ScreenPoint[], length: number): string[] {
    const marks: number[] = []
    for (let s = CHEVRON_FIRST; s <= length - CHEVRON_FIRST + 1e-6; s += CHEVRON_STEP) marks.push(s)
    if (marks.length === 0) marks.push(length / 2)
    const out: string[] = []
    for (const s of marks) {
        let left = s
        for (let i = 1; i < points.length; i++) {
            const seg = distance(points[i - 1], points[i])
            if (seg === 0) continue
            if (left <= seg || i === points.length - 1) {
                const tip = towards(points[i - 1], points[i], left)
                const dx = (points[i].x - points[i - 1].x) / seg
                const dy = (points[i].y - points[i - 1].y) / seg
                const tail = (sign: number) => {
                    const a = sign * CHEVRON_ANGLE
                    const bx = -(dx * Math.cos(a) - dy * Math.sin(a))
                    const by = -(dx * Math.sin(a) + dy * Math.cos(a))
                    return `${(tip.x + bx * CHEVRON_TAIL).toFixed(1)},${(tip.y + by * CHEVRON_TAIL).toFixed(1)}`
                }
                out.push(`${tail(1)} ${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${tail(-1)}`)
                break
            }
            left -= seg
        }
    }
    return out
}

export const TileLinks = memo(function TileLinks({ tiles, liveLinks, containers, worldOffset, svgHalfW, svgHalfH }: TileLinksProps) {
    const links = useMemo<Link[]>(() => {
        const tileById = new Map(tiles.map(t => [t.id, t]))
        const byKey = new Map<string, Link>()
        const add = (sourceId: string | null, targetId: string, variant: 'beam' | 'cable' | 'trace' | 'belt', appearDelay: number, color?: string, still?: boolean, chevrons?: boolean) => {
            if (!sourceId || sourceId === targetId) return
            const source = tileById.get(sourceId)
            const target = tileById.get(targetId)
            if (!source || !target) return
            if (!isPlaced(source.position) || !isPlaced(target.position)) return
            const id = `${sourceId}->${targetId}`
            const key = `${variant}:${id}`
            if (!byKey.has(key)) byKey.set(key, { id, key, source, target, variant, appearDelay, color, still, chevrons })
        }
        for (const l of liveLinks) add(l.source, l.target, l.variant ?? 'beam', l.appearDelay ?? 0, l.color, l.still, l.chevrons)
        return Array.from(byKey.values()).sort((a, b) => Number(a.variant === 'beam') - Number(b.variant === 'beam'))
    }, [tiles, liveLinks])

    const containerColorById = useMemo(() => {
        const m = new Map<string, string>()
        for (const c of containers) m.set(c.id, c.color)
        return m
    }, [containers])

    const layout = useMemo(
        () => JSON.stringify([tiles.map(t => ({ id: t.id, position: t.position, span: t.span })), liveLinks.map(l => ({ source: l.source, target: l.target, variant: l.variant }))]),
        [tiles, liveLinks],
    )
    const routed = useMemo(() => {
        const [routedTiles, routedLinks] = JSON.parse(layout) as [RoutedTile[], RoutedLink[]]
        return routeTileLinks(routedTiles, routedLinks)
    }, [layout])
    const routes = useMemo<Route[]>(() => {
        const out: Route[] = []
        for (const link of links) {
            const route = routed.get(link.id)
            if (!route || route.length < 2) continue
            const points = route.map(point => {
                const world = axisToWorld(point, worldOffset)
                return { x: world.x + svgHalfW, y: world.y + svgHalfH }
            })
            out.push({ link, points, d: points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '), length: polylineLength(points) })
        }
        return out
    }, [links, routed, worldOffset, svgHalfW, svgHalfH])

    if (routes.length === 0) return null

    const cables = routes.filter(route => route.link.variant === 'cable')
    const traces = routes.filter(route => (route.link.variant === 'trace' || route.link.variant === 'belt') && !route.link.still)

    return (
        <>
            <svg
                className="absolute pointer-events-none"
                style={{ left: -svgHalfW, top: -svgHalfH, overflow: 'visible' }}
                width={svgHalfW * 2}
                height={svgHalfH * 2}
            >
                <defs>
                    <filter id="agentlink-glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" />
                    </filter>
                </defs>
                {routes.map(({ link, points, d, length }) => {
                    const color = link.color ?? (link.source.containerId ? containerColorById.get(link.source.containerId) : undefined) ?? DEFAULT_COLOR

                    const dim = link.source.dimmed || link.target.dimmed

                    if (link.variant === 'trace' || link.variant === 'belt') {
                        const { period, travelRatio, phase } = traceTiming(link.id)
                        const at = (travelRatio * 100).toFixed(1)
                        const timing = {
                            animationDuration: `${period.toFixed(2)}s`,
                            animationDelay: `-${phase.toFixed(2)}s`,
                            animationTimingFunction: `linear(0 0%, 1 ${at}%, 1 100%), linear(0 0%, 0 ${at}%, 1 ${at}%, 1 100%)`,
                        }
                        return (
                            <g key={link.key} style={{ opacity: dim ? ISO_DIM_OPACITY : undefined, transition: `opacity ${ISO_DIM_MS}ms ease` }}>
                                {link.variant === 'belt' ? (
                                    <>
                                        <path d={d} fill="none" stroke={color} strokeWidth={BELT_WIDTH + 2.4} strokeLinejoin="round" opacity={0.55} />
                                        <path d={d} fill="none" stroke="#0d1122" strokeWidth={BELT_WIDTH} strokeLinejoin="round" />
                                        {link.chevrons && chevronPoints(points, length).map(pts => (
                                            <polyline key={pts} data-belt-chevron="" points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
                                        ))}
                                        {!link.still && <path d={d} className="iso-belt-slats" fill="none" stroke="rgb(var(--iso-glint) / 0.09)" strokeWidth={BELT_WIDTH - 3} strokeDasharray={BELT_SLATS} />}
                                    </>
                                ) : (
                                    <path d={d} fill="none" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'rgb(var(--iso-glint) / 0.14)' }} />
                                )}
                                {!link.still && TRACE_TRAIL.map(layer => {
                                    const lit = Math.max(6, length * layer.share)
                                    return (
                                        <path
                                            key={layer.share}
                                            d={d}
                                            className="iso-trace-trail"
                                            fill="none"
                                            stroke={color}
                                            strokeWidth={layer.width}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeDasharray={`${lit} ${length + lit}`}
                                            strokeOpacity={layer.opacity}
                                            style={{ ['--iso-trace-from' as string]: `${lit}`, ['--iso-trace-to' as string]: `${lit - length}`, ...timing }}
                                        />
                                    )
                                })}
                            </g>
                        )
                    }

                    if (link.variant === 'cable') {
                        return (
                            <path
                                key={link.key}
                                d={d}
                                fill="none"
                                strokeWidth={1}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeDasharray={link.appearDelay > 0 ? length : undefined}
                                strokeDashoffset={link.appearDelay > 0 ? 0 : undefined}
                                style={{
                                    stroke: link.color ?? 'rgb(var(--iso-glint) / 0.18)',
                                    opacity: dim ? ISO_DIM_OPACITY : undefined,
                                    transition: `opacity ${ISO_DIM_MS}ms ease`,
                                    ...(link.appearDelay > 0
                                        ? {
                                              ['--iso-cable-length' as string]: `${length}`,
                                              animation: `iso-cable-draw ${CABLE_DRAW_MS}ms ease-out ${link.appearDelay}ms backwards`,
                                          }
                                        : {}),
                                }}
                            />
                        )
                    }

                    return (
                        <g
                            key={link.key}
                            style={{
                                animation: `iso-appear 220ms ease ${link.appearDelay}ms backwards`,
                                opacity: dim ? ISO_DIM_OPACITY : undefined,
                                transition: `opacity ${ISO_DIM_MS}ms ease`,
                            }}
                        >
                            <path d={d} fill="none" style={{ stroke: 'rgb(var(--iso-glint) / 0.12)' }} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} filter="url(#agentlink-glow)" />
                            <path
                                d={d}
                                className="iso-link-current"
                                fill="none"
                                stroke={color}
                                strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeDasharray={DASH}
                                opacity={0.95}
                                style={{ ['--iso-link-dash-period' as string]: `${DASH_PERIOD}` }}
                            />
                        </g>
                    )
                })}
            </svg>
            {cables.length > 0 && (
                <div className="absolute pointer-events-none" style={{ left: -svgHalfW, top: -svgHalfH }}>
                    {cables.map(({ link, points, length }) => {
                        const dim = link.source.dimmed || link.target.dimmed
                        const { period, travelRatio, phase } = cableTiming(link.id)
                        const tail = Math.min(CABLE_TAIL_MAX, Math.max(CABLE_TAIL_MIN, length * CABLE_TAIL_RATIO))
                        const travel = (travelRatio * 100).toFixed(1)
                        const veil =
                            link.appearDelay > 0 ? { opacity: 0, animation: `iso-appear 200ms ease ${link.appearDelay + CABLE_DRAW_MS}ms forwards` } : undefined
                        return (
                            <div key={link.key} style={veil}>
                                <div style={{ opacity: dim ? ISO_DIM_OPACITY : undefined, transition: `opacity ${ISO_DIM_MS}ms ease` }}>
                                    <div
                                        className="iso-cable-comet"
                                        style={{
                                            width: tail,
                                            offsetPath: `path("${cometPath(points, tail)}")`,
                                            animationDuration: `${period.toFixed(2)}s`,
                                            animationDelay: `-${phase.toFixed(2)}s`,
                                            animationTimingFunction: `linear(0 0%, 1 ${travel}%, 1 100%), linear(0 0%, 0 ${travel}%, 1 ${travel}%, 1 100%)`,
                                        }}
                                    />
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
            {traces.length > 0 && (
                <div className="absolute pointer-events-none" style={{ left: -svgHalfW, top: -svgHalfH }}>
                    {traces.map(({ link, points }) => {
                        const { period, travelRatio, phase } = traceTiming(link.id)
                        const at = (travelRatio * 100).toFixed(1)
                        const color = link.color ?? (link.source.containerId ? containerColorById.get(link.source.containerId) : undefined) ?? DEFAULT_COLOR
                        const dim = link.source.dimmed || link.target.dimmed
                        return (
                            <div key={link.key} style={{ opacity: dim ? ISO_DIM_OPACITY : undefined, transition: `opacity ${ISO_DIM_MS}ms ease` }}>
                            <div
                                className="iso-trace-head"
                                style={{
                                    ['--iso-trace-color' as string]: color,
                                    offsetPath: `path("${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}")`,
                                    animationDuration: `${period.toFixed(2)}s`,
                                    animationDelay: `-${phase.toFixed(2)}s`,
                                    animationTimingFunction: `linear(0 0%, 1 ${at}%, 1 100%), linear(0 0%, 0 ${at}%, 1 ${at}%, 1 100%)`,
                                }}
                            />
                            </div>
                        )
                    })}
                </div>
            )}
        </>
    )
})
