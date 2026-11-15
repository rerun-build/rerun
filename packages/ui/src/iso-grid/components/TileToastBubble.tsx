'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { DEFAULT_SPAN, TILE_W, isoPosition, tileTopLift } from '../iso'
import type { Tile, TileToast } from '../types'

const HOLD_DURATION = 3500
const EXIT_DURATION = 400

const BUBBLE_GAP = 10

const BUBBLE_BOTTOM = 'rgba(26,26,34,0.98)'
const BUBBLE_BORDER = 'rgba(255,255,255,0.1)'

type Props = {
    toast: TileToast
    tile: Tile
    worldOffset: { left: number; top: number }
    onExpire?: (id: string) => void
    reducedMotion?: boolean
}

export const TileToastBubble = memo(function TileToastBubble({ toast, tile, worldOffset, onExpire, reducedMotion }: Props) {
    const [exiting, setExiting] = useState(false)

    const onExpireRef = useRef(onExpire)
    useEffect(() => {
        onExpireRef.current = onExpire
    })

    useEffect(() => {
        const exitTimer = setTimeout(() => setExiting(true), HOLD_DURATION)
        const removeTimer = setTimeout(() => onExpireRef.current?.(toast.id), HOLD_DURATION + EXIT_DURATION)
        return () => {
            clearTimeout(exitTimer)
            clearTimeout(removeTimer)
        }
    }, [toast.id])

    const span = tile.span ?? DEFAULT_SPAN
    const AW = span * TILE_W
    const pos = isoPosition(tile.position.col, tile.position.row)

    return (
        <div
            className="absolute pointer-events-none"
            style={{
                left: pos.left + worldOffset.left - TILE_W / 2,
                top: pos.top + worldOffset.top - tileTopLift(tile.style, span),
                width: AW,
                zIndex: 100000,
            }}
        >
            <div className="absolute left-1/2" style={{ bottom: BUBBLE_GAP, transform: 'translateX(-50%)' }}>
                <div
                    className="relative w-max max-w-[15rem] rounded-[0.9rem] border px-2.5 py-1.5 text-left backdrop-blur-sm"
                    style={{
                        borderColor: BUBBLE_BORDER,
                        background: `linear-gradient(180deg, rgba(42,42,52,0.98) 0%, ${BUBBLE_BOTTOM} 100%)`,
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 8px 22px -8px rgba(0,0,0,0.8)',
                        animation: reducedMotion ? undefined : exiting ? `agent-toast-out ${EXIT_DURATION}ms ease-in forwards` : 'agent-toast-in 280ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                >
                    {toast.author && <span className="mb-0.5 block text-[8px] leading-none font-semibold tracking-wide text-white/45 uppercase">{toast.author}</span>}
                    <span className="block text-[9.5px] leading-[1.45] font-medium text-white/92">{toast.message}</span>
                    <span
                        aria-hidden
                        className="absolute left-1/2 size-2 border-r border-b"
                        style={{
                            bottom: -4,
                            borderColor: BUBBLE_BORDER,
                            background: BUBBLE_BOTTOM,
                            transform: 'translateX(-50%) rotate(45deg)',
                            clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
                        }}
                    />
                </div>
            </div>
        </div>
    )
})
