'use client'

import { memo, useEffect, useState } from 'react'
import { Badge } from '../../primitives/badge'
import { DEFAULT_SPAN, TILE_W, isoPosition, tileTopLift } from '../iso'
import type { Tile } from '../types'
import { useKitTranslations } from '../../locale'
import { tileStatusLabel } from '../status-label'

const ENTER_MS = 200
const EXIT_MS = 140

type Props = {
    tile: Tile | null
    worldOffset: { left: number; top: number }
    reducedMotion?: boolean
}

export const TileStatusBubble = memo(function TileStatusBubble({ tile, worldOffset, reducedMotion }: Props) {
    const t = useKitTranslations()
    const active = tile?.style.status ? tile : null
    const [rendered, setRendered] = useState<Tile | null>(active)

    useEffect(() => {
        if (active) {
            setRendered(active)
            return
        }
        if (!rendered) return
        const timer = setTimeout(() => setRendered(null), reducedMotion ? 0 : EXIT_MS)
        return () => clearTimeout(timer)
    }, [active, rendered, reducedMotion])

    const status = rendered?.style.status
    if (!rendered || !status) return null

    const exiting = active === null
    const span = rendered.span ?? DEFAULT_SPAN
    const AW = span * TILE_W
    const pos = isoPosition(rendered.position.col, rendered.position.row)

    return (
        <div
            className="absolute pointer-events-none"
            style={{
                left: pos.left + worldOffset.left - TILE_W / 2,
                top: pos.top + worldOffset.top - tileTopLift(rendered.style, span),
                width: AW,
                zIndex: 99999,
            }}
        >
            <div className="absolute left-1/2" style={{ top: -24, transform: 'translateX(-50%)' }}>
                <div
                    key={rendered.id}
                    className="inline-flex rounded-full bg-background/95"
                    style={{
                        animation: reducedMotion
                            ? undefined
                            : exiting
                              ? `iso-status-out ${EXIT_MS}ms ease-in forwards`
                              : `agent-toast-in ${ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                    }}
                >
                    <Badge tone={status.tone} size="xs" className="gap-0.5 px-1.5 py-px text-[8px]">
                        {tileStatusLabel(status, t)}
                    </Badge>
                </div>
            </div>
        </div>
    )
})
