'use client'

import type { FactorySnapshot } from '@rerun/contracts'
import { IsoGrid, frameTemplateBoard, routeTileLinks, useRenderedFrame, type AxisPoint, type Tile } from '@rerun/ui/iso-grid'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

import { fireRerunConfetti } from '@/lib/confetti'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { applyMoves, canMove, dropReason, layoutStorageKey, loadLayout, readMoves, saveLayout, subscribeLayout } from './factory-layout'
import { METRICS, barModel, type MetricDef, type MetricKey, type MetricValues } from './factory-metrics'
import { FactoryBarFrame } from './FactoryBarFrame'
import { floorFrame } from './factory-camera'
import { FactoryOverlay } from './FactoryOverlay'
import { LOOP_MS, factoryScene, type Cell, type FactoryFrame } from './factory-scene'

const OVERHEAD_PX = 120
const BAR_PX = 110
const BAR_MARGIN_PX = 20
const SIDE_PX = 40

const TICK_MS = 250

function useStable<T>(value: T): T {
    const key = JSON.stringify(value)
    const held = useRef({ key, value })
    if (held.current.key !== key) held.current = { key, value }
    return held.current.value
}

type SceneFn = (t: number, now: number) => FactoryFrame

function LiveOverlay({ start, tiles, routes, scene, selectedIssue, onSelectJob }: { start: number; tiles: Tile[]; routes: Map<string, AxisPoint[]>; scene: SceneFn; selectedIssue: number | null; onSelectJob: ((issue: number) => void) | undefined }) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), TICK_MS)
        return () => clearInterval(id)
    }, [])
    const frame = scene((now - start) % LOOP_MS, now)
    return <FactoryOverlay tiles={tiles} routes={routes} pods={frame.pods} cabinets={frame.cabinets} plans={frame.plans ?? []} rejects={frame.rejects} held={frame.held} holdLeftMs={frame.holdLeftMs} links={frame.links} selectedIssue={selectedIssue} {...(onSelectJob ? { onSelectJob } : {})} />
}

export function FactoryWorld({ theme = 'dark', scene = factoryScene, workspace = 'sample', selectedIssue = null, onSelectJob, onOpenCoworker, rightInset = 0, snapshot = null, topBar }: { theme?: 'light' | 'dark'; scene?: SceneFn; workspace?: string; selectedIssue?: number | null; onSelectJob?: (issue: number) => void; onOpenCoworker?: (name: string) => void; rightInset?: number; snapshot?: FactorySnapshot | null; topBar?: ReactNode }) {
    const [clock, setClock] = useState(() => ({ start: Date.now(), now: Date.now() }))
    const [expired, setExpired] = useState<Set<string>>(() => new Set())
    useEffect(() => {
        const id = setInterval(() => setClock(c => ({ ...c, now: Date.now() })), TICK_MS)
        return () => clearInterval(id)
    }, [])

    const t = (clock.now - clock.start) % LOOP_MS
    const frame = useMemo(() => scene(t, clock.now), [scene, t, clock.now])
    const loop = Math.floor((clock.now - clock.start) / LOOP_MS)
    const toasts = useStable(frame.toasts.map(toast => ({ ...toast, id: `${toast.id}#${loop}` })).filter(toast => !expired.has(toast.id)).slice(-2))
    const sceneTiles = useStable(frame.tiles)
    const storageKey = layoutStorageKey(workspace)
    const saved = useSyncExternalStore(subscribeLayout, () => loadLayout(storageKey), () => null)
    const boxes = frame.containers
    const moves = useMemo(() => readMoves(saved, sceneTiles, boxes), [saved, sceneTiles, boxes])
    const tiles = useMemo(() => applyMoves(sceneTiles, moves, boxes), [sceneTiles, moves, boxes])
    const onTileMove = useCallback((id: string, cell: Cell) => {
        if (canMove(sceneTiles, moves, id, cell, boxes)) saveLayout(storageKey, { ...moves, [id]: cell })
    }, [sceneTiles, moves, storageKey, boxes])
    const canDropTile = useCallback((id: string, cell: Cell) => dropReason(sceneTiles, moves, id, cell, boxes), [sceneTiles, moves, boxes])
    const moved = Object.keys(moves).length > 0
    const links = useStable(frame.links)
    const routes = useMemo(() => routeTileLinks(tiles, links), [tiles, links])
    const onToastExpire = useCallback((id: string) => setExpired(prev => new Set(prev).add(id)), [])
    const worldOverlay = useCallback(() => <LiveOverlay start={clock.start} tiles={tiles} routes={routes} scene={scene} selectedIssue={selectedIssue} onSelectJob={onSelectJob} />, [clock.start, tiles, routes, scene, selectedIssue, onSelectJob])
    const gridTiles = useMemo(() => (onOpenCoworker ? tiles.map(t => (t.style?.buddy ? { ...t, selectable: true } : t)) : tiles), [tiles, onOpenCoworker])
    const onTileSelect = useCallback((id: string | null) => { if (id && onOpenCoworker) onOpenCoworker(id) }, [onOpenCoworker])

    const fullCabinets = frame.cabinets.filter(c => c.slots.every(s => s.state !== 'empty')).length
    const full = useRef(fullCabinets)
    useEffect(() => {
        if (fullCabinets > full.current) void fireRerunConfetti()
        full.current = fullCabinets
    }, [fullCabinets])

    const { ref, frame: size } = useRenderedFrame()
    const { ref: barRef, frame: bar } = useRenderedFrame()
    const { ref: topRef, frame: top } = useRenderedFrame()
    const corners = useMemo(() => frame.containers.flatMap(c => [
        { id: `${c.id}-a`, position: { col: c.col_start, row: c.row_start }, span: 1, style: { color: '' } },
        { id: `${c.id}-b`, position: { col: c.col_end, row: c.row_end }, span: 1, style: { color: '' } },
        { id: `${c.id}-c`, position: { col: c.col_end, row: c.row_start }, span: 1, style: { color: '' } },
        { id: `${c.id}-d`, position: { col: c.col_start, row: c.row_end }, span: 1, style: { color: '' } },
    ] as Tile[]), [frame.containers])
    const barSpace = bar ? bar.height + 2 * BAR_MARGIN_PX : BAR_PX
    const topSpace = topBar ? (top ? top.height + 2 * BAR_MARGIN_PX : BAR_PX) : 0
    const camera = useMemo(() => {
        if (!size) return null
        const { width, height, shiftX, shiftY } = floorFrame({ stage: size, rightInset, topSpace, bottomSpace: barSpace, overhead: OVERHEAD_PX, side: SIDE_PX })
        const c = frameTemplateBoard(corners, { width, height }, 2, 0.94, 0.1)
        return { zoom: c.zoom, pan: { x: c.pan.x + shiftX / c.zoom, y: c.pan.y + shiftY / c.zoom } }
    }, [size, corners, rightInset, barSpace, topSpace])

    const { sample, values } = barModel({ snapshot, counts: frame.counts, held: frame.held, now: clock.now, start: clock.start })

    return (
        <div ref={ref} className={`${theme} relative h-dvh w-full overflow-hidden bg-background text-foreground`} style={{ '--factory-drop-max': `${size ? size.height - topSpace - barSpace : 0}px` } as CSSProperties}>
            <IsoGrid
                tiles={gridTiles}
                containers={frame.containers}
                liveLinks={links}
                toasts={toasts}
                onToastExpire={onToastExpire}
                camera={camera}
                cameraTransitionMs={0}
                showLinks
                onTileMove={onTileMove}
                canDropTile={canDropTile}
                selectedTileId={null}
                {...(onOpenCoworker ? { onTileSelect } : {})}
                scrollGestures
                worldOverlay={worldOverlay}
            />

            <FactoryBarFrame edge="bottom" rightInset={rightInset} frameRef={barRef}>
                <div className="flex items-center gap-2 pr-1">
                    <span className={`size-2 rounded-full ${frame.held ? 'bg-red-500' : 'animate-pulse bg-emerald-500 motion-reduce:animate-none'}`} />
                    <span className="text-sm font-semibold tracking-tight">Factory</span>
                    {sample && <span className="text-[10px] text-muted-foreground">sample</span>}
                </div>
                {(['jobs', 'runs', 'plan'] as const).map(group => (
                    <div key={group} className="flex flex-wrap items-center justify-center gap-4 border-l border-border/70 pl-4">
                        {METRICS.filter(m => m.group === group).map(m => <Metric key={m.key} def={m} value={values[m.key]} />)}
                    </div>
                ))}
                {moved && (
                    <div className="flex items-center border-l border-border/70 pl-4">
                        <Button type="button" variant="outline" size="sm" onClick={() => saveLayout(storageKey, null)}>
                            Reset layout
                        </Button>
                    </div>
                )}
            </FactoryBarFrame>

            {topBar && (
                <FactoryBarFrame edge="top" rightInset={rightInset} frameRef={topRef}>
                    {topBar}
                </FactoryBarFrame>
            )}

            <div
                className="pointer-events-none absolute left-0 flex justify-center transition-all duration-500 motion-reduce:transition-none"
                style={{ right: rightInset, top: 24 + topSpace, opacity: frame.held ? 1 : 0, transform: frame.held ? 'translateY(0)' : 'translateY(-12px)' }}
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
                <div className="flex cursor-help flex-col items-center justify-center leading-none" tabIndex={0} {...(value.title ? { title: value.title } : {})}>
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
