'use client'

// A feature is stored data: a tank standing on its tile. It fills gold as its tasks merge, with a red
// layer at the bottom for the rejected ones; solid, nothing see-through. The empty part is the work left.

import { type Tile } from '@rerun/ui/iso-grid'

import { centreOf, toWorld } from './factory-rest'
import { type CabinetView } from './factory-scene'

const W = 52 // body width, px
const H = 64 // body height, px
const RY = 8 // half-height of the top and bottom ellipses

export function FeatureTank({ cab, tile }: { cab: CabinetView; tile: Tile }) {
    const c = toWorld(centreOf(tile))
    const n = cab.slots.length
    const merged = cab.slots.filter(x => x.state === 'merged').reduce((acc, x) => acc + x.arriving, 0)
    const rejected = cab.slots.filter(x => x.state === 'rejected').reduce((acc, x) => acc + x.arriving, 0)
    const done = merged + rejected
    const full = cab.slots.every(x => x.state !== 'empty' && x.arriving >= 1)
    const goldH = H * done / n, redH = H * rejected / n
    const y = (share: number) => H - H * share
    const uid = `tank-${cab.issue}`
    const r = W / 2
    return (
        <div className="fab-feature absolute" style={{ left: 0, top: 0, transform: `translate(${c.x}px, ${c.y - H - 4}px)` }}
            data-tank="feature" data-tasks={n} data-merged={merged} data-rejected={rejected} data-full={full || undefined}>
            <span className="fab-feature-glow" />
            <svg className="absolute overflow-visible" width={W + 4} height={H + 2 * RY + 4} viewBox={`${-r - 2} ${-RY - 2} ${W + 4} ${H + 2 * RY + 4}`} style={{ left: -r - 2, top: -RY - 2 }}>
                <defs>
                    <clipPath id={`clip-${uid}`}><path d={`M${-r},0 L${-r},${H} A${r},${RY} 0 0 0 ${r},${H} L${r},0 Z`} /></clipPath>
                    <linearGradient id={`gold-${uid}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stopColor="#ffd56b" />
                        <stop offset="1" stopColor="#c98a12" />
                    </linearGradient>
                    <linearGradient id={`red-${uid}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stopColor="#b91c1c" />
                        <stop offset="1" stopColor="#7f1d1d" />
                    </linearGradient>
                </defs>
                <path data-part="shell" d={`M${-r},0 L${-r},${H} A${r},${RY} 0 0 0 ${r},${H} L${r},0 Z`} fill="#1b2140" className="fab-tank-rim" />
                <rect data-part="body" x={-r} y={0} width={W} height={H} fill="none" />
                <g clipPath={`url(#clip-${uid})`}>
                    <rect data-part="gold" x={-r} width={W} y={y(done / n)} height={goldH} fill={`url(#gold-${uid})`} className="fab-feature-fill" />
                    <rect data-part="red" x={-r} width={W} y={y(rejected / n)} height={redH} fill={`url(#red-${uid})`} className="fab-feature-fill" />
                    {Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={-r} x2={r} y1={y((i + 1) / n)} y2={y((i + 1) / n)} className="fab-feature-tick" />)}
                    {done > 0 && done < n && <ellipse cx={0} cy={y(done / n)} rx={r} ry={3} className="fab-feature-surface" />}
                </g>
                <ellipse data-part="bottom" cx={0} cy={H} rx={r} ry={RY} fill="none" className="fab-tank-rim" />
                <ellipse data-part="top" cx={0} cy={0} rx={r} ry={RY} fill="#262d55" className="fab-tank-rim" />
            </svg>
            <div className="fab-feature-label" style={{ top: H + RY + 6 }}>
                <span className="fab-feature-count">{Math.round(done)}/{n}</span>
                <span>#{cab.issue} {cab.title}</span>
            </div>
        </div>
    )
}

export const TANK_CSS = `
.fab-feature-glow { position: absolute; left: -46px; top: ${H - 10}px; width: 92px; height: 46px; border-radius: 50%;
  background: radial-gradient(closest-side, #8a6a22, transparent); opacity: 0; }
.fab-feature[data-full] .fab-feature-glow { opacity: 1; }
.fab-tank-rim { stroke: #8c97c4; stroke-width: 1.2; }
.fab-feature-fill { transition: y 1.1s cubic-bezier(.22,1,.36,1), height 1.1s cubic-bezier(.22,1,.36,1); }
.fab-feature-tick { stroke: #1b2140; stroke-width: .6; }
.fab-feature-surface { fill: #fff2c2; }
.fab-feature-label { position: absolute; left: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px; white-space: nowrap; font: 500 8px/1.2 ui-sans-serif, system-ui; color: #c9d3ff; }
.fab-feature-count { font: 700 12px/1 ui-monospace, monospace; color: #ffe08a; text-shadow: 0 0 6px rgba(255,214,120,.6); }
@media (prefers-reduced-motion: no-preference) {
  .fab-feature[data-full] .fab-feature-glow { animation: fab-glow 2.8s ease-in-out infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .fab-feature-fill { transition: none !important; }
}
`
