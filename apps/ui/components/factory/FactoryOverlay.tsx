'use client'

// The factory's moving parts, drawn in the board's world through IsoGrid's worldOverlay: task spheres
// riding the belts (the same route TileLinks draws, so a sphere sits on its belt), the gates of
// review, the reject bin and the feature tanks. The spheres move on the scene's clock with a short
// transition between ticks; the slosh, shakes and glows are CSS. Under reduced motion the transitions
// and loops stop and the spheres step from place to place.

import { type AxisPoint, type Tile, type TileLink } from '@rerun/ui/iso-grid'

import { along, atDistance, centreOf, inScanner, lineUp, podPath, settles, workSpot, toWorld, type P } from './factory-rest'
import { Gate, GATE_CSS } from './FactoryGate'
import { HOLD_CSS, HoldBarrier } from './FactoryHold'
import { FeatureTank, RejectTank, TANK_CSS } from './FactoryTank'
import { Sphere, SPHERE_CSS } from './FactorySphere'
import { type CabinetView, type PodView } from './factory-scene'

// `routes` are the board's own, from routeTileLinks on the same tiles and links, so a sphere rides
// the belt drawn under it.
export function FactoryOverlay({ tiles, routes, pods, cabinets, rejects, held, holdLeftMs = 0, links = [], selectedIssue = null, onSelectJob }: { tiles: Tile[]; routes: Map<string, AxisPoint[]>; pods: PodView[]; cabinets: CabinetView[]; rejects: number; held: boolean; holdLeftMs?: number; links?: TileLink[]; selectedIssue?: number | null; onSelectJob?: (issue: number) => void }) {
    const byId = new Map(tiles.map(t => [t.id, t]))
    // Waiting tasks line up per belt from its start, the one waiting longest first (factory-rest.ts).
    const lineIndex = new Map<string, number>()
    const belts = new Map<string, PodView[]>()
    for (const p of pods) if (p.state === 'queued' || p.state === 'held') {
        const key = `${p.path[0]}>${p.path[1]}`
        belts.set(key, [...(belts.get(key) ?? []), p])
    }
    for (const group of belts.values()) group.sort((a, b) => (a.since ?? 0) - (b.since ?? 0) || a.issue - b.issue).forEach((p, i) => lineIndex.set(p.id, i))
    return (
        <div className="fab-layer pointer-events-none absolute left-0 top-0" style={{ zIndex: 90_000 }} data-held={held || undefined}>
            <style>{FAB_CSS + SPHERE_CSS + GATE_CSS + TANK_CSS + HOLD_CSS}</style>
            {byId.get('rejects') && <RejectTank tile={byId.get('rejects')!} count={rejects} />}
            {cabinets.map(c => {
                const t = byId.get(`cab-${c.issue}`)
                return t ? <FeatureTank key={c.issue} cab={c} tile={t} /> : null
            })}
            {held && links.filter(l => l.variant === 'belt' && l.source === 'Delegator').map(l => {
                const key = `${l.source}->${l.target}`
                const pts = (routes.get(key) ?? []).map(toWorld)
                if (pts.length < 2) return null
                const angle = (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI
                return <HoldBarrier key={key} at={atDistance(pts, 48)} angle={angle} leftMs={holdLeftMs} />
            })}
            {pods.map(p => {
                const pts = podPath(p.path, byId, routes)
                if (pts.length < 2) return null
                const holder = settles(p) ? byId.get(p.path[p.path.length - 1]) : undefined
                const at = lineIndex.has(p.id) ? lineUp(pts, lineIndex.get(p.id)!) : holder ? along([...pts, workSpot(holder, inScanner(p))], p.travel) : along(pts, p.travel)
                return inScanner(p)
                    ? <Gate key={p.id} pod={p} at={at}><Sphere pod={p} at={{ x: 0, y: 0 }} selected={selectedIssue === p.issue} onSelectJob={onSelectJob} /></Gate>
                    : <Sphere key={p.id} pod={p} at={at} selected={selectedIssue === p.issue} onSelectJob={onSelectJob} />
            })}
        </div>
    )
}

const FAB_CSS = `
@media (prefers-reduced-motion: no-preference) {
  .fab-scanner[data-verdict='fail'] { animation: fab-reject 500ms ease-out 1; }
}
@keyframes fab-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-1.6px) rotate(-3deg); } 40% { transform: translateX(1.6px) rotate(3deg); } 60% { transform: translateX(-1px); } 80% { transform: translateX(1px); } }
@keyframes fab-reject { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 50% { transform: translateX(3px); } 75% { transform: translateX(-2px); } }
@keyframes fab-glow { 0%, 100% { opacity: .8; } 50% { opacity: 1; } }
[data-iso-paused] .fab-layer *, [data-iso-paused] .fab-layer *::after { animation-play-state: paused !important; }
`
