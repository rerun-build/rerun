'use client'

import { memo, useMemo } from 'react'
import { DEFAULT_SPAN, ISO_DIM_MS, ISO_DIM_OPACITY, TILE_H, TILE_W, hashUnit, isPlaced } from '../iso'
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
    variant: 'beam' | 'cable'
    appearDelay: number
    color?: string
}

type TileAxis = { u: number; v: number; half: number }
type AxisPoint = { u: number; v: number }

function tileAxis(tile: Tile): TileAxis {
    const span = tile.span ?? DEFAULT_SPAN
    return { u: tile.position.col + span / 2, v: tile.position.row + span / 2, half: span / 2 }
}

function axisToWorld(point: AxisPoint, worldOffset: WorldOffset) {
    return {
        x: (point.u - point.v) * HALF_W + HALF_W + worldOffset.left,
        y: (point.u + point.v) * HALF_H + worldOffset.top,
    }
}

function routeLink(source: TileAxis, target: TileAxis): AxisPoint[] {
    const du = target.u - source.u
    const dv = target.v - source.v
    const su = Math.sign(du) || 1
    const sv = Math.sign(dv) || 1

    if (Math.abs(du) >= source.half && Math.abs(dv) > target.half) {
        return [
            { u: source.u + su * source.half, v: source.v },
            { u: target.u, v: source.v },
            { u: target.u, v: target.v - sv * target.half },
        ]
    }

    if (Math.abs(dv) >= source.half && Math.abs(du) > target.half) {
        return [
            { u: source.u, v: source.v + sv * source.half },
            { u: source.u, v: target.v },
            { u: target.u - su * target.half, v: target.v },
        ]
    }

    if (Math.abs(du) >= source.half + target.half) {
        const from = source.u + su * source.half
        const to = target.u - su * target.half
        const mid = (from + to) / 2
        return [
            { u: from, v: source.v },
            { u: mid, v: source.v },
            { u: mid, v: target.v },
            { u: to, v: target.v },
        ]
    }

    if (Math.abs(dv) >= source.half + target.half) {
        const from = source.v + sv * source.half
        const to = target.v - sv * target.half
        const mid = (from + to) / 2
        return [
            { u: source.u, v: from },
            { u: source.u, v: mid },
            { u: target.u, v: mid },
            { u: target.u, v: to },
        ]
    }

    return [
        { u: source.u, v: source.v },
        { u: target.u, v: target.v },
    ]
}

function cableTiming(id: string) {
    const travel = 1.7 + hashUnit(id, 1) * 1.5
    const rest = 0.5 + hashUnit(id, 2) * 2
    const period = travel + rest
    return { period, travelRatio: travel / period, phase: hashUnit(id, 3) * period }
}

function dedupe(points: AxisPoint[]) {
    return points.filter((point, index) => index === 0 || point.u !== points[index - 1].u || point.v !== points[index - 1].v)
}

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

export const TileLinks = memo(function TileLinks({ tiles, liveLinks, containers, worldOffset, svgHalfW, svgHalfH }: TileLinksProps) {
    const links = useMemo<Link[]>(() => {
        const tileById = new Map(tiles.map(t => [t.id, t]))
        const byKey = new Map<string, Link>()
        const add = (sourceId: string | null, targetId: string, variant: 'beam' | 'cable', appearDelay: number, color?: string) => {
            if (!sourceId || sourceId === targetId) return
            const source = tileById.get(sourceId)
            const target = tileById.get(targetId)
            if (!source || !target) return
            if (!isPlaced(source.position) || !isPlaced(target.position)) return
            const id = `${sourceId}->${targetId}`
            const key = `${variant}:${id}`
            if (!byKey.has(key)) byKey.set(key, { id, key, source, target, variant, appearDelay, color })
        }
        for (const l of liveLinks) add(l.source, l.target, l.variant ?? 'beam', l.appearDelay ?? 0, l.color)
        return Array.from(byKey.values()).sort((a, b) => Number(a.variant === 'beam') - Number(b.variant === 'beam'))
    }, [tiles, liveLinks])

    const containerColorById = useMemo(() => {
        const m = new Map<string, string>()
        for (const c of containers) m.set(c.id, c.color)
        return m
    }, [containers])

    const routes = useMemo<Route[]>(() => {
        const out: Route[] = []
        for (const link of links) {
            const route = dedupe(routeLink(tileAxis(link.source), tileAxis(link.target)))
            if (route.length < 2) continue
            const points = route.map(point => {
                const world = axisToWorld(point, worldOffset)
                return { x: world.x + svgHalfW, y: world.y + svgHalfH }
            })
            out.push({ link, points, d: points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '), length: polylineLength(points) })
        }
        return out
    }, [links, worldOffset, svgHalfW, svgHalfH])

    if (routes.length === 0) return null

    const cables = routes.filter(route => route.link.variant === 'cable')

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
        </>
    )
})
