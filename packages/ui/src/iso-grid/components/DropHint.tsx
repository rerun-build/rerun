'use client'

import { TILE_H, TILE_W } from '../iso'

export const DROP_REFUSAL_MS = 2000

export function DropHint({
    box,
    span,
    reason,
    zIndex,
}: {
    box: { left: number; top: number; width: number; height: number }
    span: number
    reason: string | null
    zIndex: number
}) {
    const W = span * TILE_W
    const H = span * TILE_H
    const refused = reason !== null
    return (
        <>
            <svg
                className="absolute pointer-events-none"
                data-drop-hint={refused ? 'refused' : 'ok'}
                style={{ left: box.left, top: box.top, width: box.width, height: box.height, zIndex, pointerEvents: 'none' }}
            >
                <polygon
                    points={`${W / 2},0 ${W},${H / 2} ${W / 2},${H} 0,${H / 2}`}
                    fill={refused ? 'rgba(239,68,68,0.35)' : 'rgba(45,212,163,0.35)'}
                    stroke={refused ? '#ef4444' : '#2dd4a3'}
                    strokeWidth="1"
                />
            </svg>
            {refused && (
                <div
                    role="status"
                    data-drop-reason
                    className="absolute pointer-events-none whitespace-nowrap rounded px-2 py-0.5 text-[11px] leading-none"
                    style={{
                        left: box.left + box.width / 2,
                        top: box.top + box.height + 4,
                        transform: 'translateX(-50%)',
                        zIndex,
                        pointerEvents: 'none',
                        background: 'rgba(15,17,23,0.9)',
                        color: '#fff',
                    }}
                >
                    {reason}
                </div>
            )}
        </>
    )
}
