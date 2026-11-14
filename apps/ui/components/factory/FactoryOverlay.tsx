'use client'

// The factory's moving parts, drawn in the board's world through IsoGrid's worldOverlay: task spheres
// riding the belts (the same route TileLinks draws, so a sphere sits on its belt), the gates of
// review, the reject bin and the feature tanks. The spheres move on the scene's clock with a short
// transition between ticks; the slosh, shakes and glows are CSS. Under reduced motion the transitions
// and loops stop and the spheres step from place to place.

import { type AxisPoint, type Tile } from '@rerun/ui/iso-grid'

import { along, atDistance, centreOf, inScanner, podPath, restDistances, settles, toWorld, type P } from './factory-rest'
import { Gate, GATE_CSS } from './FactoryGate'
import { FeatureTank, TANK_CSS } from './FactoryTank'
import { STATUS_COLOR, type CabinetView, type PodView } from './factory-scene'

const QUEUE_GAP = 40 // px between waiting spheres on the loader's line

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

// `routes` are the board's own, from routeTileLinks on the same tiles and links, so a sphere rides
// the belt drawn under it.
export function FactoryOverlay({ tiles, routes, pods, cabinets, rejects, held, selectedIssue = null, onSelectJob }: { tiles: Tile[]; routes: Map<string, AxisPoint[]>; pods: PodView[]; cabinets: CabinetView[]; rejects: number; held: boolean; selectedIssue?: number | null; onSelectJob?: (issue: number) => void }) {
    const byId = new Map(tiles.map(t => [t.id, t]))
    // A sphere being worked rests short of whoever works it, clear of every block and every other
    // resting sphere (factory-rest.ts).
    const rests = restDistances(pods, tiles, routes)
    return (
        <div className="fab-layer pointer-events-none absolute left-0 top-0" style={{ zIndex: 90_000 }} data-held={held || undefined}>
            <style>{FAB_CSS + GATE_CSS + TANK_CSS}</style>
            {byId.get('rejects') && <RejectBin tile={byId.get('rejects')!} count={rejects} />}
            {cabinets.map(c => {
                const t = byId.get(`cab-${c.issue}`)
                return t ? <FeatureTank key={c.issue} cab={c} tile={t} /> : null
            })}
            {pods.map(p => {
                const pts = podPath(p.path, byId, routes)
                if (pts.length < 2) return null
                const at = p.state === 'queued' || p.state === 'held' ? atDistance(pts, 22 + p.queue * QUEUE_GAP) : settles(p) ? atDistance(pts, (rests.get(p.id) ?? 0) * p.travel) : along(pts, p.travel)
                return inScanner(p)
                    ? <Gate key={p.id} pod={p} at={at}><Orb pod={p} at={{ x: 0, y: 0 }} selected={selectedIssue === p.issue} onSelectJob={onSelectJob} /></Gate>
                    : <Orb key={p.id} pod={p} at={at} selected={selectedIssue === p.issue} onSelectJob={onSelectJob} />
            })}
        </div>
    )
}

// A task: a glass sphere sitting on the line to whoever works it, filling like a liquid in the colour of
// its status. The level is the task's progress, exact; the surface sways a little, the glass catches
// the light, and a soft glow under it lights the line.
function Orb({ pod, at, selected = false, onSelectJob }: { pod: PodView; at: P; selected?: boolean; onSelectJob?: (issue: number) => void }) {
    const color = pod.state === 'working' ? STATUS_COLOR[pod.band === 'review' ? 'review' : 'build'] : STATUS_COLOR[pod.state === 'complete' ? 'complete' : pod.state === 'rejected' ? 'rejected' : pod.state === 'held' ? 'held' : pod.state === 'checks' ? 'checks' : pod.state === 'fixing' ? 'fixing' : 'queued']
    const R = 15
    const level = Math.max(0.04, pod.level)
    const surface = R - 2 * R * level // y of the liquid surface inside the sphere
    const uid = pod.id
    const wobble = (hash(pod.id) % 1000) / 1000
    return (
        <div className="fab-orb-pos absolute" style={{ left: 0, top: 0, transform: `translate(${at.x}px, ${at.y - R - 3}px)` }}>
            <div className="fab-orb" data-state={pod.state} style={{ ['--orb' as string]: color, ['--wobble-delay' as string]: `${-wobble * 3}s` }}>
                <span className="fab-orb-glow" />
                <svg
                    className="fab-orb-svg"
                    data-orb={pod.issue}
                    data-selected={selected || undefined}
                    {...(onSelectJob ? {
                        // Only the sphere takes the pointer; the rest of the overlay stays click-through.
                        style: { pointerEvents: 'auto' as const, cursor: 'pointer' },
                        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
                        onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelectJob(pod.issue) },
                    } : {})}
                    viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`} width={2 * R + 4} height={2 * R + 4}>
                    <defs>
                        <clipPath id={`clip-${uid}`}><circle r={R - 0.8} /></clipPath>
                        <radialGradient id={`liq-${uid}`} cx="40%" cy="30%" r="80%">
                            <stop offset="0" stopColor="#fff" stopOpacity=".55" />
                            <stop offset=".35" stopColor={color} stopOpacity=".95" />
                            <stop offset="1" stopColor={color} stopOpacity=".55" />
                        </radialGradient>
                    </defs>
                    <circle r={R} className="fab-orb-glass" />
                    <g clipPath={`url(#clip-${uid})`}>
                        <g className="fab-liquid" style={{ transform: `translateY(${surface}px)` }}>
                            <rect x={-R - 4} y={0} width={2 * R + 8} height={2 * R + 4} fill={`url(#liq-${uid})`} />
                            <ellipse className="fab-surface" cx={0} cy={0} rx={R + 2} ry={2.2} fill={color} />
                        </g>
                    </g>
                    <circle r={R} className="fab-orb-rim" />
                    {selected && <circle r={R + 3} fill="none" stroke={color} strokeWidth={2} className="fab-orb-ring" />}
                    <ellipse cx={-5} cy={-7.5} rx={4.6} ry={2.6} className="fab-orb-shine" />
                </svg>
                <span className="fab-orb-tag">#{pod.issue}<b>{Math.round(pod.level * 100)}%</b></span>
            </div>
        </div>
    )
}

// The reject bin: an open bin of dark red glass. Each defect that lands in it adds a dull red sphere
// to the heap, and the count sits on its rim.
function RejectBin({ tile, count }: { tile: Tile; count: number }) {
    const c = toWorld(centreOf(tile))
    const W = 38, H = 26
    return (
        <div className="fab-bin absolute" data-filled={count > 0 || undefined} style={{ left: 0, top: 0, transform: `translate(${c.x}px, ${c.y}px)` }}>
            <svg className="absolute overflow-visible" width="1" height="1">
                <path d={`M${-W},${-H} L0,${-H + 19} L0,19 L${-W},0 Z`} className="fab-bin-left" />
                <path d={`M0,${-H + 19} L${W},${-H} L${W},0 L0,19 Z`} className="fab-bin-right" />
                {Array.from({ length: Math.min(count, 6) }, (_, i) => (
                    <circle key={i} cx={-12 + (i % 3) * 12} cy={-H + 6 - Math.floor(i / 3) * 7} r={6} className="fab-bin-part" />
                ))}
                <path d={`M${-W},${-H} L0,${-H - 19} L${W},${-H} L0,${-H + 19} Z`} className="fab-bin-rim" />
            </svg>
            <div className="fab-bin-label" style={{ top: 26 }}>
                <span className="fab-bin-count">{count}</span>
                <span>rejected</span>
            </div>
        </div>
    )
}

const FAB_CSS = `
.fab-orb-pos { transition: transform 260ms linear; will-change: transform; }
.fab-orb { position: relative; }
.fab-orb-glow { position: absolute; left: -30px; top: -4px; width: 60px; height: 30px; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--orb) 55%, transparent), transparent); opacity: .5; transform: translateY(14px); }
.fab-orb-svg { position: absolute; left: -17px; top: -17px; overflow: visible; filter: drop-shadow(0 3px 3px rgba(0,0,0,.55)); }
.fab-orb-glass { fill: rgba(18,22,40,.55); }
.fab-orb-rim { fill: none; stroke: rgba(210,220,255,.55); stroke-width: .8; }
.fab-orb-shine { fill: #fff; opacity: .55; }
.fab-liquid { transition: transform 900ms cubic-bezier(.22,1,.36,1); }
.fab-surface { opacity: .9; }
.fab-orb-tag { position: absolute; left: 50%; top: 20px; transform: translateX(-50%); display: flex; gap: 4px; font: 600 8px/1 ui-monospace, monospace; color: #c9d3ff; opacity: .85; white-space: nowrap; }
.fab-orb-tag b { color: var(--orb); font-weight: 700; }
.fab-orb[data-state='queued'] .fab-orb-glow, .fab-orb[data-state='held'] .fab-orb-glow { opacity: .25; }
.fab-orb[data-state='held'] .fab-orb-rim { stroke: #ef4444; }
.fab-orb[data-state='complete'] .fab-orb-rim { stroke: #ffe08a; stroke-width: 1.2; }
.fab-orb[data-state='complete'] .fab-orb-glow { opacity: .9; }
.fab-bin-left { fill: rgba(80,18,22,.55); stroke: rgba(248,113,113,.45); stroke-width: .8; }
.fab-bin-right { fill: rgba(110,24,28,.55); stroke: rgba(248,113,113,.5); stroke-width: .8; }
.fab-bin-rim { fill: rgba(30,8,10,.75); stroke: #f87171; stroke-width: 1; }
.fab-bin-part { fill: #7f1d1d; stroke: #f87171; stroke-width: .6; }
.fab-bin[data-filled] .fab-bin-rim { filter: drop-shadow(0 0 4px rgba(248,113,113,.7)); }
.fab-bin-label { position: absolute; left: 0; transform: translateX(-50%); display: flex; gap: 4px; align-items: baseline; white-space: nowrap; font: 500 8px/1 ui-sans-serif, system-ui; color: #fca5a5; }
.fab-bin-count { font: 700 12px/1 ui-monospace, monospace; color: #f87171; }

@media (prefers-reduced-motion: no-preference) {
  .fab-surface { animation: fab-slosh 2.6s ease-in-out var(--wobble-delay, 0s) infinite; }
  .fab-orb[data-state='working'] .fab-orb-glow { animation: fab-pulse 2.2s ease-in-out var(--wobble-delay, 0s) infinite; }
  .fab-orb[data-state='complete'] { animation: fab-shake 700ms cubic-bezier(.36,.07,.19,.97) 1; }
  .fab-orb[data-state='rejected'] { animation: fab-reject 500ms ease-out 1; }
  .fab-scanner[data-verdict='fail'] { animation: fab-reject 500ms ease-out 1; }
}
@keyframes fab-slosh { 0%, 100% { transform: rotate(-4deg) scaleY(1); } 50% { transform: rotate(4deg) scaleY(1.25); } }
@keyframes fab-pulse { 0%, 100% { opacity: .35; } 50% { opacity: .7; } }
@keyframes fab-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-1.6px) rotate(-3deg); } 40% { transform: translateX(1.6px) rotate(3deg); } 60% { transform: translateX(-1px); } 80% { transform: translateX(1px); } }
@keyframes fab-reject { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 50% { transform: translateX(3px); } 75% { transform: translateX(-2px); } }
@keyframes fab-glow { 0%, 100% { opacity: .8; } 50% { opacity: 1; } }
[data-iso-paused] .fab-layer *, [data-iso-paused] .fab-layer *::after { animation-play-state: paused !important; }
@media (prefers-reduced-motion: reduce) {
  .fab-orb-pos, .fab-liquid { transition: none !important; }
}
`
