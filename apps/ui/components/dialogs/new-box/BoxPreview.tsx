'use client'

import { type Container, GRID_SIZE, IsoGrid, isoPosition, SPACE_COLOR, TILE_H, TILE_W, useRenderedFrame } from '@rerun/ui/iso-grid'
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

const RECT = { col_start: 0, row_start: 0, col_end: 4, row_end: 4 }
const CENTER_ISO = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)
const LABEL_RISE = 34
const INSET = 0.66
const MAX_ZOOM = 1.3

function corner(col: number, row: number) {
    const { left, top } = isoPosition(col, row)
    return { x: left + TILE_W / 2 - CENTER_ISO.left, y: top - CENTER_ISO.top }
}

const NORTH = corner(RECT.col_start, RECT.row_start)
const EAST = corner(RECT.col_end + 1, RECT.row_start)
const SOUTH = corner(RECT.col_end + 1, RECT.row_end + 1)
const WEST = corner(RECT.col_start, RECT.row_end + 1)
const BOUNDS = { left: WEST.x, right: EAST.x, top: NORTH.y - LABEL_RISE, bottom: SOUTH.y + TILE_H }
const FLOOR_CENTER = { x: (WEST.x + EAST.x) / 2, y: (NORTH.y + SOUTH.y) / 2 }

function fit(frame: { width: number; height: number }) {
    const zoom = Math.min(MAX_ZOOM, (frame.width * INSET) / (BOUNDS.right - BOUNDS.left), (frame.height * INSET) / (BOUNDS.bottom - BOUNDS.top))
    return { zoom, pan: { x: -(BOUNDS.left + BOUNDS.right) / 2, y: -(BOUNDS.top + BOUNDS.bottom) / 2 } }
}

export function BoxPreview({ name, drawKey, onFloor, mask, className, style }: { name: string | null; drawKey: string | null; onFloor?: ReactNode; mask?: string; className?: string; style?: CSSProperties }) {
    const { ref, frame } = useRenderedFrame()
    const camera = frame ? fit(frame) : null
    const floor = camera && frame ? { x: frame.width / 2 + (FLOOR_CENTER.x + camera.pan.x) * camera.zoom, y: frame.height / 2 + (FLOOR_CENTER.y + camera.pan.y) * camera.zoom } : null

    const box: Container = {
        id: drawKey ? `new-box-${drawKey}` : 'new-box',
        label: name,
        color: SPACE_COLOR,
        ...RECT,
        ghost: !name,
        justPlaced: Boolean(drawKey),
        dropStyle: 'draw',
        dropDuration: 700,
    }

    return (
        <div ref={ref} aria-hidden className={cn('relative overflow-hidden', className)} style={style}>
            {camera && <IsoGrid tiles={[]} containers={[box]} selectedContainerId={null} selectedTileId={null} camera={camera} mask={mask} canDraw={false} locked scrollGestures={false} className="size-full" />}
            {floor && camera && <FloorGlow key={drawKey ?? 'still'} at={floor} width={420 * camera.zoom} rising={Boolean(drawKey)} />}
            {floor && onFloor && (
                <div className="absolute -translate-x-1/2 -translate-y-full" style={{ left: floor.x, top: floor.y }}>
                    {onFloor}
                </div>
            )}
        </div>
    )
}

function FloorGlow({ at, width, rising }: { at: { x: number; y: number }; width: number; rising: boolean }) {
    const place = { left: at.x, top: at.y, width, height: width / 2 }
    return (
        <span className={cn('absolute inset-0', rising && 'animate-in fade-in-0 duration-1000')}>
            <span className="pointer-events-none absolute hidden -translate-x-1/2 -translate-y-1/2 mix-blend-screen dark:block" style={{ ...place, background: 'radial-gradient(closest-side, rgb(104 80 252 / 0.32), rgb(104 80 252 / 0.12) 55%, transparent)' }} />
            <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 mix-blend-multiply dark:hidden" style={{ ...place, background: 'radial-gradient(closest-side, rgb(104 80 252 / 0.16), rgb(104 80 252 / 0.06) 55%, transparent)' }} />
        </span>
    )
}
