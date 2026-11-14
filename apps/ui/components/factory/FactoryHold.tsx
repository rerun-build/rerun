'use client'

import { type P } from './factory-rest'

const HALF = 18 // half of the 36 px flat side
const BULGE = 12 // depth of the half-disc
const RED = '#ef4444', EDGE = '#7f1d1d', PILL = '#b91c1c'

export const formatLeft = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function HoldBarrier({ at, angle, leftMs }: { at: P; angle: number; leftMs: number }) {
    return (
        <div className="absolute" data-hold-barrier style={{ left: 0, top: 0, transform: `translate(${at.x}px, ${at.y}px)` }}>
            <div className="absolute" style={{ left: 0, top: 0, transform: `rotate(${angle}deg)` }} data-hold-rotate>
                <svg className="absolute overflow-visible" width="1" height="1">
                    <path data-hold-shape d={`M0,${-HALF} L0,${HALF} A${BULGE},${HALF} 0 0 1 ${-BULGE},0 A${BULGE},${HALF} 0 0 1 0,${-HALF} Z`} fill={RED} stroke={EDGE} strokeWidth={2} strokeLinejoin="round" />
                </svg>
            </div>
            <div className="fab-hold-left absolute" data-hold-left style={{ left: 0, top: HALF + 6, transform: 'translateX(-50%)', background: PILL }}>{formatLeft(leftMs)}</div>
        </div>
    )
}

export const HOLD_CSS = `
.fab-hold-left { color: #fff; font: 600 11px/1 ui-monospace, monospace; padding: 3px 7px; border-radius: 999px; white-space: nowrap; border: 1px solid #7f1d1d; }
`
