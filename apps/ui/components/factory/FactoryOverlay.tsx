'use client'

// The factory's moving parts, drawn in the board's world through IsoGrid's worldOverlay: task spheres
// riding the belts (the same route TileLinks draws, so a sphere sits on its belt), the scanner gates of
// review, the reject bin and the feature spheres. The spheres move on the scene's clock with a short
// transition between ticks; the slosh, shakes and glows are CSS. Under reduced motion the transitions
// and loops stop and the spheres step from place to place.

import { type AxisPoint, type Tile } from '@rerun/ui/iso-grid'

import { along, atDistance, centreOf, inScanner, podPath, restDistances, settles, toWorld, type P } from './factory-rest'
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
            <style>{FAB_CSS}</style>
            {byId.get('rejects') && <RejectBin tile={byId.get('rejects')!} count={rejects} />}
            {cabinets.map(c => {
                const t = byId.get(`cab-${c.issue}`)
                return t ? <FeatureOrb key={c.issue} cab={c} tile={t} /> : null
            })}
            {pods.map(p => {
                const pts = podPath(p.path, byId, routes)
                if (pts.length < 2) return null
                const at = p.state === 'queued' || p.state === 'held' ? atDistance(pts, 22 + p.queue * QUEUE_GAP) : settles(p) ? atDistance(pts, (rests.get(p.id) ?? 0) * p.travel) : along(pts, p.travel)
                return inScanner(p)
                    ? <Scanner key={p.id} pod={p} at={at}><Orb pod={p} at={{ x: 0, y: 0 }} selected={selectedIssue === p.issue} onSelectJob={onSelectJob} /></Scanner>
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

// A review is an X-ray scanner standing on the belt: the sphere waits inside the gate while a line of
// light sweeps it, then the gate glows green and lets it on, or glows red, shakes, and turns it aside.
function Scanner({ pod, at, children }: { pod: PodView; at: P; children: React.ReactNode }) {
    const W = 30, H = 46, D = 15 // half-width of the gate's footprint, its height, half-depth
    const sweep = (pod.scan * 3) % 1
    return (
        <div className="fab-scanner absolute" data-verdict={pod.verdict} style={{ left: 0, top: 0, transform: `translate(${at.x}px, ${at.y}px)` }}>
            <svg className="absolute overflow-visible" width="1" height="1">
                {/* Back wall of the gate, then the sphere, then the front frame over it. */}
                <path d={`M${-W},${-H} L0,${-H - D} L${W},${-H} L${W},0 L0,${-D} L${-W},0 Z`} className="fab-scan-back" />
            </svg>
            <div className="absolute" style={{ left: 0, top: -6 }}>{children}</div>
            <svg className="absolute overflow-visible" width="1" height="1">
                <line x1={-W + 3} x2={W - 3} y1={-H + 6 + sweep * (H - 12)} y2={-H + 6 + sweep * (H - 12)} className="fab-scan-line" style={{ opacity: pod.verdict ? 0 : 0.9 }} />
                <path d={`M${-W},0 L${-W},${-H} L0,${-H + D} L${W},${-H} L${W},0`} className="fab-scan-frame" />
                <path d={`M${-W},${-H} L0,${-H - D} L${W},${-H} L0,${-H + D} Z`} className="fab-scan-top" />
                <circle cx={W - 6} cy={-H + 6} r={2} className="fab-scan-lamp" />
            </svg>
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

// A feature: a large glass sphere on its tile, filling as its tasks end. Merged tasks fill it gold,
// rejected ones settle as a red layer at the bottom; the empty part is the exact work left.
function FeatureOrb({ cab, tile }: { cab: CabinetView; tile: Tile }) {
    const c = toWorld(centreOf(tile))
    const R = 30
    const n = cab.slots.length
    const merged = cab.slots.filter(x => x.state === 'merged').reduce((acc, x) => acc + x.arriving, 0)
    const rejected = cab.slots.filter(x => x.state === 'rejected').reduce((acc, x) => acc + x.arriving, 0)
    const done = merged + rejected
    const full = cab.slots.every(x => x.state !== 'empty' && x.arriving >= 1)
    const y = (share: number) => R - 2 * R * share
    const uid = `feat-${cab.issue}`
    return (
        <div className="fab-feature absolute" style={{ left: 0, top: 0, transform: `translate(${c.x}px, ${c.y - R - 8}px)` }} data-full={full || undefined}>
            <span className="fab-feature-glow" style={{ opacity: 0.25 + 0.6 * (done / n) }} />
            <svg className="absolute overflow-visible" width={2 * R + 4} height={2 * R + 4} viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`} style={{ left: -R - 2, top: -R - 2 }}>
                <defs>
                    <clipPath id={`clip-${uid}`}><circle r={R - 1} /></clipPath>
                    <radialGradient id={`gold-${uid}`} cx="40%" cy="25%" r="85%">
                        <stop offset="0" stopColor="#fff7d6" stopOpacity=".9" />
                        <stop offset=".4" stopColor="#ffd56b" />
                        <stop offset="1" stopColor="#c98a12" />
                    </radialGradient>
                </defs>
                <circle r={R} className="fab-orb-glass" />
                <g clipPath={`url(#clip-${uid})`}>
                    <rect x={-R} width={2 * R} y={y(done / n)} height={2 * R} fill={`url(#gold-${uid})`} className="fab-feature-fill" />
                    <rect x={-R} width={2 * R} y={y(rejected / n)} height={2 * R} fill="#7f1d1d" opacity={0.9} className="fab-feature-fill" />
                    {Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={-R} x2={R} y1={y((i + 1) / n)} y2={y((i + 1) / n)} className="fab-feature-tick" />)}
                    <ellipse cx={0} cy={y(done / n)} rx={R} ry={3} className="fab-feature-surface" style={{ opacity: done > 0 && done < n ? 0.9 : 0 }} />
                </g>
                <circle r={R} className="fab-orb-rim" />
                <ellipse cx={-10} cy={-15} rx={9} ry={5} className="fab-orb-shine" />
            </svg>
            <div className="fab-feature-label" style={{ top: R + 6 }}>
                <span className="fab-feature-count">{Math.round(done)}/{n}</span>
                <span>#{cab.issue} {cab.title}</span>
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
.fab-scan-back { fill: rgba(14,18,34,.8); stroke: rgba(160,175,230,.25); stroke-width: .8; }
.fab-scan-frame { fill: none; stroke: #9fb0e8; stroke-width: 2.4; stroke-linejoin: round; opacity: .85; transition: stroke .3s ease; }
.fab-scan-top { fill: rgba(60,72,120,.55); stroke: rgba(170,185,240,.5); stroke-width: .8; }
.fab-scan-line { stroke: #2dd4a3; stroke-width: 1.4; filter: drop-shadow(0 0 3px #2dd4a3); transition: opacity .2s ease; }
.fab-scan-lamp { fill: #2dd4a3; }
.fab-scanner[data-verdict='pass'] .fab-scan-frame { stroke: #2dd4a3; filter: drop-shadow(0 0 4px #2dd4a3); }
.fab-scanner[data-verdict='fail'] .fab-scan-frame { stroke: #ef4444; filter: drop-shadow(0 0 5px #ef4444); }
.fab-scanner[data-verdict='fail'] .fab-scan-lamp { fill: #ef4444; }
.fab-bin-left { fill: rgba(80,18,22,.55); stroke: rgba(248,113,113,.45); stroke-width: .8; }
.fab-bin-right { fill: rgba(110,24,28,.55); stroke: rgba(248,113,113,.5); stroke-width: .8; }
.fab-bin-rim { fill: rgba(30,8,10,.75); stroke: #f87171; stroke-width: 1; }
.fab-bin-part { fill: #7f1d1d; stroke: #f87171; stroke-width: .6; }
.fab-bin[data-filled] .fab-bin-rim { filter: drop-shadow(0 0 4px rgba(248,113,113,.7)); }
.fab-bin-label { position: absolute; left: 0; transform: translateX(-50%); display: flex; gap: 4px; align-items: baseline; white-space: nowrap; font: 500 8px/1 ui-sans-serif, system-ui; color: #fca5a5; }
.fab-bin-count { font: 700 12px/1 ui-monospace, monospace; color: #f87171; }
.fab-feature-glow { position: absolute; left: -46px; top: 10px; width: 92px; height: 46px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255,214,107,.55), transparent); transition: opacity .9s ease; }
.fab-feature-fill { transition: y 1.1s cubic-bezier(.22,1,.36,1); }
.fab-feature-tick { stroke: rgba(20,24,40,.55); stroke-width: .6; }
.fab-feature-surface { fill: #fff2c2; transition: cy 1.1s cubic-bezier(.22,1,.36,1), opacity .4s ease; }
.fab-feature-label { position: absolute; left: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px; white-space: nowrap; font: 500 8px/1.2 ui-sans-serif, system-ui; color: #c9d3ff; }
.fab-feature-count { font: 700 12px/1 ui-monospace, monospace; color: #ffe08a; text-shadow: 0 0 6px rgba(255,214,120,.6); }

@media (prefers-reduced-motion: no-preference) {
  .fab-surface { animation: fab-slosh 2.6s ease-in-out var(--wobble-delay, 0s) infinite; }
  .fab-orb[data-state='working'] .fab-orb-glow { animation: fab-pulse 2.2s ease-in-out var(--wobble-delay, 0s) infinite; }
  .fab-orb[data-state='complete'] { animation: fab-shake 700ms cubic-bezier(.36,.07,.19,.97) 1; }
  .fab-orb[data-state='rejected'] { animation: fab-reject 500ms ease-out 1; }
  .fab-scanner[data-verdict='fail'] { animation: fab-reject 500ms ease-out 1; }
  .fab-scanner[data-verdict='pass'] .fab-scan-frame { animation: fab-glow 900ms ease-out 1; }
  .fab-feature[data-full] .fab-feature-glow { animation: fab-glow 2.8s ease-in-out infinite; }
}
@keyframes fab-slosh { 0%, 100% { transform: rotate(-4deg) scaleY(1); } 50% { transform: rotate(4deg) scaleY(1.25); } }
@keyframes fab-pulse { 0%, 100% { opacity: .35; } 50% { opacity: .7; } }
@keyframes fab-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-1.6px) rotate(-3deg); } 40% { transform: translateX(1.6px) rotate(3deg); } 60% { transform: translateX(-1px); } 80% { transform: translateX(1px); } }
@keyframes fab-reject { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 50% { transform: translateX(3px); } 75% { transform: translateX(-2px); } }
@keyframes fab-glow { 0%, 100% { opacity: .8; } 50% { opacity: 1; } }
[data-iso-paused] .fab-layer *, [data-iso-paused] .fab-layer *::after { animation-play-state: paused !important; }
@media (prefers-reduced-motion: reduce) {
  .fab-orb-pos, .fab-liquid, .fab-feature-fill, .fab-feature-surface, .fab-feature-glow { transition: none !important; }
}
`
