'use client'

import { useState } from 'react'

import { STATUS_COLOR, type PodView } from './factory-scene'
import type { P } from './factory-rest'
import { formatInState } from './FactoryTasks'

const clock = () => Date.now()
const R = 15
const DISC = '#1b2140'

const colorOf = (pod: PodView) => pod.state === 'working' ? STATUS_COLOR[pod.band === 'review' ? 'review' : 'build'] : STATUS_COLOR[pod.state === 'complete' ? 'complete' : pod.state === 'rejected' ? 'rejected' : pod.state === 'held' ? 'held' : pod.state === 'checks' ? 'checks' : pod.state === 'fixing' ? 'fixing' : 'queued']
export const stageWord = (pod: PodView) => pod.state === 'working' ? (pod.band === 'review' ? 'review' : 'build') : pod.state === 'complete' ? 'merged' : pod.state === 'fixing' ? 'fix' : pod.state

export function Sphere({ pod, at, selected = false, onSelectJob }: { pod: PodView; at: P; selected?: boolean; onSelectJob?: (issue: number) => void }) {
    const [hover, setHover] = useState(false)
    const color = colorOf(pod)
    const level = Math.max(0, Math.min(1, pod.level))
    const h = 2 * R * level
    const uid = pod.id
    return (
        <div className="fab-orb-pos absolute" style={{ left: 0, top: 0, transform: `translate(${at.x}px, ${at.y - R - 3}px)` }}>
            <div className="fab-orb" data-state={pod.state} style={{ ['--orb' as string]: color }}>
                <svg
                    className="fab-orb-svg"
                    data-orb={pod.issue}
                    data-selected={selected || undefined}
                    data-level={pod.level}
                    onPointerEnter={() => setHover(true)}
                    onPointerLeave={() => setHover(false)}
                    {...(onSelectJob ? {
                        style: { pointerEvents: 'auto' as const, cursor: 'pointer' },
                        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
                        onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelectJob(pod.issue) },
                    } : {})}
                    viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`} width={2 * R + 4} height={2 * R + 4}>
                    <defs><clipPath id={`clip-${uid}`}><circle r={R} /></clipPath></defs>
                    <circle r={R} fill={DISC} data-part="disc" />
                    <g clipPath={`url(#clip-${uid})`}>
                        <rect data-part="fill" x={-R} y={R - h} width={2 * R} height={h} fill={color} />
                        {h > 0 && <rect data-part="edge" x={-R} y={R - h} width={2 * R} height={1} className="fab-orb-edge" />}
                    </g>
                    <circle r={R} className="fab-orb-rim" />
                    {selected && <circle r={R + 3} fill="none" stroke={color} strokeWidth={2} className="fab-orb-ring" />}
                    <ellipse cx={-5} cy={-7.5} rx={3.6} ry={2} fill="#e8edff" />
                </svg>
                <span className="fab-orb-tag">#{pod.issue}<b>{stageWord(pod)}</b></span>
                {hover && <span className="fab-orb-card" data-card={pod.issue}>#{pod.issue} {pod.title}<br />stage: {stageWord(pod)}
                    {pod.holder && <><br /><span data-card-line="holder">holder: {pod.holder}</span></>}
                    {pod.since !== undefined && <><br /><span data-card-line="since">in stage: {formatInState(clock() - pod.since)}</span></>}
                    {pod.pr !== undefined && <><br /><span data-card-line="pr">PR #{pod.pr}</span></>}
                </span>}
            </div>
        </div>
    )
}

export const SPHERE_CSS = `
.fab-orb-pos { transition: transform 260ms linear; will-change: transform; }
.fab-orb { position: relative; }
.fab-orb-svg { position: absolute; left: -17px; top: -17px; overflow: visible; }
.fab-orb-rim { fill: none; stroke: #5b6485; stroke-width: .8; }
.fab-orb-edge { fill: color-mix(in srgb, var(--orb) 65%, white); }
.fab-orb-tag { position: absolute; left: 50%; top: 20px; transform: translateX(-50%); display: flex; gap: 4px; font: 600 8px/1 ui-monospace, monospace; color: #c9d3ff; white-space: nowrap; }
.fab-orb-tag b { color: var(--orb); font-weight: 700; }
.fab-orb-card { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 4px 6px; background: #12172b; border: 1px solid #5b6485; color: #c9d3ff; font: 600 9px/1.3 ui-monospace, monospace; white-space: nowrap; pointer-events: none; z-index: 5; }
.fab-orb[data-state='held'] .fab-orb-rim { stroke: #ef4444; }
.fab-orb[data-state='complete'] .fab-orb-rim { stroke: #ffe08a; stroke-width: 1.2; }

@media (prefers-reduced-motion: no-preference) {
  .fab-orb[data-state='complete'] { animation: fab-shake 700ms cubic-bezier(.36,.07,.19,.97) 1; }
  .fab-orb[data-state='rejected'] { animation: fab-reject 500ms ease-out 1; }
}
@media (prefers-reduced-motion: reduce) {
  .fab-orb-pos { transition: none !important; }
}
`
