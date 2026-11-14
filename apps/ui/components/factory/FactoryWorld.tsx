'use client'

import { IsoGrid, frameTemplateBoard, routeTileLinks, useRenderedFrame, type AxisPoint, type Tile } from '@rerun/ui/iso-grid'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fireRerunConfetti } from '@/lib/confetti'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { METRICS, type MetricDef, type MetricKey, type MetricValues } from './factory-metrics'
import { FactoryOverlay } from './FactoryOverlay'
import { LOOP_MS, factoryScene, type FactoryFrame } from './factory-scene'

// The feature spheres and scanner gates stand above the floor, so the camera frames the Boxes with headroom above them.
const OVERHEAD_PX = 120
const BAR_PX = 110

const TICK_MS = 250

// The board re-renders only when what it draws changes: a value keeps its identity until its content
// does. The scene is rebuilt every tick, but tiles and links change only when a task changes stage.
function useStable<T>(value: T): T {
    const key = JSON.stringify(value)
    const held = useRef({ key, value })
    if (held.current.key !== key) held.current = { key, value }
    return held.current.value
}

// The moving parts keep a clock of their own, so the spheres glide while the board stays still.
type SceneFn = (t: number, now: number) => FactoryFrame

function LiveOverlay({ start, tiles, routes, scene }: { start: number; tiles: Tile[]; routes: Map<string, AxisPoint[]>; scene: SceneFn }) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), TICK_MS)
        return () => clearInterval(id)
    }, [])
    const frame = scene((now - start) % LOOP_MS, now)
    return <FactoryOverlay tiles={tiles} routes={routes} pods={frame.pods} cabinets={frame.cabinets} rejects={frame.rejects} held={frame.held} />
}

// The factory, drawn by the board's own world. The world takes the whole stage; a thin glass bar
// carries the gauges and the counts, and a band drops in while sending is held.
export function FactoryWorld({ theme = 'dark', scene = factoryScene }: { theme?: 'light' | 'dark'; scene?: SceneFn }) {
    const [clock, setClock] = useState(() => ({ start: Date.now(), now: Date.now() }))
    const [expired, setExpired] = useState<Set<string>>(() => new Set())
    useEffect(() => {
        const id = setInterval(() => setClock(c => ({ ...c, now: Date.now() })), TICK_MS)
        return () => clearInterval(id)
    }, [])

    const t = (clock.now - clock.start) % LOOP_MS
    const frame = useMemo(() => scene(t, clock.now), [scene, t, clock.now])
    // Two bubbles at most, the newest: more read as noise.
    // A toast's id carries the loop's number, so the same moment in the next loop is a new toast.
    const loop = Math.floor((clock.now - clock.start) / LOOP_MS)
    const toasts = useStable(frame.toasts.map(toast => ({ ...toast, id: `${toast.id}#${loop}` })).filter(toast => !expired.has(toast.id)).slice(-2))
    const tiles = useStable(frame.tiles)
    const links = useStable(frame.links)
    // The belts' routes, once per layout: the same call TileLinks makes on the same tiles and links.
    const routes = useMemo(() => routeTileLinks(tiles, links), [tiles, links])
    const onToastExpire = useCallback((id: string) => setExpired(prev => new Set(prev).add(id)), [])
    const worldOverlay = useCallback(() => <LiveOverlay start={clock.start} tiles={tiles} routes={routes} scene={scene} />, [clock.start, tiles, routes, scene])

    // A feature whose sphere fills throws the app's own confetti; a single merge has its own shake.
    const fullCabinets = frame.cabinets.filter(c => c.slots.every(s => s.state !== 'empty')).length
    const full = useRef(fullCabinets)
    useEffect(() => {
        if (fullCabinets > full.current) void fireRerunConfetti()
        full.current = fullCabinets
    }, [fullCabinets])

    const { ref, frame: size } = useRenderedFrame()
    const corners = useMemo(() => frame.containers.flatMap(c => [
        { id: `${c.id}-a`, position: { col: c.col_start, row: c.row_start }, span: 1, style: { color: '' } },
        { id: `${c.id}-b`, position: { col: c.col_end, row: c.row_end }, span: 1, style: { color: '' } },
        { id: `${c.id}-c`, position: { col: c.col_end, row: c.row_start }, span: 1, style: { color: '' } },
        { id: `${c.id}-d`, position: { col: c.col_start, row: c.row_end }, span: 1, style: { color: '' } },
    ] as Tile[]), [frame.containers])
    const camera = useMemo(() => {
        if (!size) return null
        const c = frameTemplateBoard(corners, { width: size.width, height: size.height - OVERHEAD_PX - BAR_PX }, 2, 0.94)
        return { zoom: c.zoom, pan: { x: c.pan.x, y: c.pan.y + (OVERHEAD_PX - BAR_PX) / 2 / c.zoom } }
    }, [size, corners])

    const signInMin = Math.max(0, 412 - Math.floor((clock.now - clock.start) / 60_000))
    // shortcut: the run measures are sample numbers that grow with the loop; the page reads the
    // engine's stats endpoint (runs dataset, 24h) instead.
    const runs = 118 + frame.counts.runs
    const values: MetricValues = {
        queued: { text: String(frame.counts.queued) },
        building: { text: String(frame.counts.building) },
        review: { text: String(frame.counts.review) },
        checks: { text: String(frame.counts.checks) },
        shipped: { text: String(frame.counts.merged) },
        runs: { text: String(runs) },
        totalTokens: { text: `${(runs * 0.31).toFixed(1)}M` },
        cachedShare: { text: '87%', fill: 87 },
        avgDuration: { text: '2m 41s' },
        errorRate: { text: '1.7%' },
        planWeek: { text: '56%', fill: 56 },
        signIn: frame.held ? { text: 'renewing', fill: 2, warn: true } : { text: `${signInMin} min`, fill: Math.min(100, (signInMin / 480) * 100) },
    }

    return (
        <div ref={ref} className={`${theme} relative h-dvh w-full overflow-hidden bg-background text-foreground`}>
            <IsoGrid
                tiles={tiles}
                containers={frame.containers}
                liveLinks={links}
                toasts={toasts}
                onToastExpire={onToastExpire}
                camera={camera}
                cameraTransitionMs={0}
                showLinks
                selectedTileId={null}
                scrollGestures
                worldOverlay={worldOverlay}
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-5">
                <div className="pointer-events-auto flex items-stretch gap-4 rounded-2xl border border-border/60 bg-background/75 px-5 py-3 shadow-[0_8px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl">
                    <div className="flex items-center gap-2 pr-1">
                        <span className={`size-2 rounded-full ${frame.held ? 'bg-red-500' : 'animate-pulse bg-emerald-500 motion-reduce:animate-none'}`} />
                        <span className="text-sm font-semibold tracking-tight">Factory</span>
                        <span className="text-[10px] text-muted-foreground">sample</span>
                    </div>
                    {(['jobs', 'runs', 'plan'] as const).map(group => (
                        <div key={group} className="flex items-center gap-4 border-l border-border/70 pl-4">
                            {METRICS.filter(m => m.group === group).map(m => <Metric key={m.key} def={m} value={values[m.key]} />)}
                        </div>
                    ))}
                </div>
            </div>

            <div
                className="pointer-events-none absolute inset-x-0 top-6 flex justify-center transition-all duration-500 motion-reduce:transition-none"
                style={{ opacity: frame.held ? 1 : 0, transform: frame.held ? 'translateY(0)' : 'translateY(-12px)' }}
            >
                <div className="flex items-center gap-3 rounded-full border border-red-500/40 bg-red-500/15 px-4 py-1.5 text-sm text-red-600 shadow-[0_0_24px_rgba(239,68,68,0.35)] backdrop-blur-xl dark:text-red-300">
                    <span className="font-semibold">Line held</span>
                    <span>sign-in renewal · {Math.ceil(frame.holdLeftMs / 1000)} s left · running builds finish</span>
                </div>
            </div>
        </div>
    )
}

const TONES: Partial<Record<MetricKey, string>> = { building: 'text-amber-500', review: 'text-emerald-500', checks: 'text-sky-500', shipped: 'text-green-500' }

function Metric({ def, value }: { def: MetricDef; value: MetricValues[MetricKey] }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className="flex cursor-help flex-col items-center justify-center leading-none" tabIndex={0}>
                    <span className={`font-mono text-base font-semibold tabular-nums ${value.warn ? 'text-red-500' : (TONES[def.key] ?? 'text-foreground')}`}>{value.text}</span>
                    {value.fill !== undefined && (
                        <span className="mt-1 h-1 w-14 overflow-hidden rounded-full bg-muted">
                            <span className={`block h-full rounded-full transition-all duration-700 ${value.warn ? 'bg-red-500' : 'bg-[#4d34f7]'}`} style={{ width: `${value.fill}%` }} />
                        </span>
                    )}
                    <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{def.label}</span>
                </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
                <p>{def.definition}</p>
                <p className="mt-1 opacity-70">Source: {def.source}</p>
            </TooltipContent>
        </Tooltip>
    )
}
