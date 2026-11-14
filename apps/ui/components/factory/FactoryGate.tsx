'use client'

import { type P } from './factory-rest'
import { type PodView } from './factory-scene'

const HW = 34, HH = 28, CY = 30 // half-width, half-height, centre height above the belt point
const GREY = '#5b6485', PASS = '#2dd4a3', FAIL = '#ef4444', STEEL = '#9fb0e8'

export function Gate({ pod, at, children }: { pod: PodView; at: P; children: React.ReactNode }) {
    const sweep = (pod.scan * 3) % 1
    const stroke = pod.verdict === 'pass' ? PASS : pod.verdict === 'fail' ? FAIL : STEEL
    const cy = -CY
    return (
        <div className="fab-scanner absolute" data-verdict={pod.verdict} style={{ left: 0, top: 0, transform: `translate(${at.x}px, ${at.y}px)` }}>
            <svg className="absolute overflow-visible" width="1" height="1">
                <path data-shape="diamond" d={`M${-HW},${cy} L0,${cy - HH} L${HW},${cy} L0,${cy + HH} Z`} fill="#141a30" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
                <path data-exit="pass" d={`M${HW},${cy} L${HW + 10},${cy}`} fill="none" stroke={pod.verdict === 'pass' ? PASS : GREY} strokeWidth={2} strokeLinecap="round" />
                <path data-exit="fail" d={`M0,${cy + HH} L0,${cy + HH + 10}`} fill="none" stroke={pod.verdict === 'fail' ? FAIL : GREY} strokeWidth={2} strokeLinecap="round" />
            </svg>
            <div className="absolute" style={{ left: 0, top: -12 }}>{children}</div>
            <svg className="absolute overflow-visible" width="1" height="1">
                <line x1={-HW / 2} x2={HW / 2} y1={cy - HH / 2 + sweep * HH} y2={cy - HH / 2 + sweep * HH} className="fab-scan-line" style={{ opacity: pod.verdict ? 0 : 0.9 }} />
            </svg>
        </div>
    )
}

export const GATE_CSS = `
.fab-scan-line { stroke: #2dd4a3; stroke-width: 1.4; filter: drop-shadow(0 0 3px #2dd4a3); transition: opacity .2s ease; }
.fab-scanner[data-verdict='pass'] [data-shape='diamond'] { filter: drop-shadow(0 0 4px #2dd4a3); }
.fab-scanner[data-verdict='fail'] [data-shape='diamond'] { filter: drop-shadow(0 0 5px #ef4444); }
`
