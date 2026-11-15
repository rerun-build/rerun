'use client'

import { memo, useMemo } from 'react'
import { TILE_H, TILE_W, containerFaceCenter, isoPosition, tileZ } from '../iso'
import type { Container, ContainerSide } from '../types'

const HIT_W = TILE_W
const HIT_H = TILE_H

function floorPath(corners: [number, number][], radius: number) {
    const cut = (from: [number, number], to: [number, number]): [number, number] => {
        const dx = to[0] - from[0]
        const dy = to[1] - from[1]
        const len = Math.hypot(dx, dy)
        const k = Math.min(radius, len / 2) / len
        return [from[0] + dx * k, from[1] + dy * k]
    }
    const at = ([u, v]: [number, number]) => {
        const p = isoPosition(u, v)
        return `${p.left.toFixed(2)},${p.top.toFixed(2)}`
    }

    const n = corners.length
    let d = ''
    for (let i = 0; i < n; i++) {
        const cur = corners[i]
        const enter = cut(cur, corners[(i - 1 + n) % n])
        const exit = cut(cur, corners[(i + 1) % n])
        d += `${i === 0 ? 'M' : 'L'} ${at(enter)} Q ${at(cur)} ${at(exit)} `
    }

    const points = corners.map(([u, v]) => isoPosition(u, v))
    return {
        d: `${d}Z`,
        halfW: Math.max(...points.map(p => Math.abs(p.left))),
        halfH: Math.max(...points.map(p => Math.abs(p.top))),
    }
}

const CIRCLE_KAPPA = 0.5522847498307936

function floorCircle(radius: number) {
    const k = radius * CIRCLE_KAPPA
    const at = (u: number, v: number) => {
        const p = isoPosition(u, v)
        return `${p.left.toFixed(2)},${p.top.toFixed(2)}`
    }

    const d =
        `M ${at(radius, 0)} ` +
        `C ${at(radius, k)} ${at(k, radius)} ${at(0, radius)} ` +
        `C ${at(-k, radius)} ${at(-radius, k)} ${at(-radius, 0)} ` +
        `C ${at(-radius, -k)} ${at(-k, -radius)} ${at(0, -radius)} ` +
        `C ${at(k, -radius)} ${at(radius, -k)} ${at(radius, 0)} Z`

    const diag = radius * Math.SQRT1_2
    return { d, halfW: isoPosition(diag, -diag).left, halfH: isoPosition(diag, diag).top }
}

const PLUS_ARM = 0.17
const PLUS_THICKNESS = 0.024
const PLUS_RADIUS = 0.021

const PLATE_PADDING = 0.105

const MARK = (() => {
    const plate = floorCircle(PLUS_ARM + PLATE_PADDING)

    const a = PLUS_ARM
    const t = PLUS_THICKNESS
    const plus = floorPath(
        [
            [-t, -a],
            [t, -a],
            [t, -t],
            [a, -t],
            [a, t],
            [t, t],
            [t, a],
            [-t, a],
            [-t, t],
            [-a, t],
            [-a, -t],
            [-t, -t],
        ],
        PLUS_RADIUS
    )

    const pad = 2
    return { plate: plate.d, plus: plus.d, width: 2 * plate.halfW + pad, height: 2 * plate.halfH + pad }
})()

const FACE_GAP = 0.5

function anchorForSide(container: Container, side: ContainerSide) {
    const face = containerFaceCenter(container, side)

    switch (side) {
        case 'top-right':
            return { col: face.col, row: face.row - FACE_GAP }
        case 'bottom-right':
            return { col: face.col + FACE_GAP, row: face.row }
        case 'bottom-left':
            return { col: face.col, row: face.row + FACE_GAP }
        case 'top-left':
            return { col: face.col - FACE_GAP, row: face.row }
    }
}

type ContainerAddHandlesProps = {
    container: Container
    sides: readonly ContainerSide[]
    worldOffset: { left: number; top: number }
    label: string
    activeSide: ContainerSide | null
    onAdd: (containerId: string, side: ContainerSide) => void
    onSideHover: (containerId: string, side: ContainerSide | null) => void
}

export const ContainerAddHandles = memo(function ContainerAddHandles({ container, sides, worldOffset, label, activeSide, onAdd, onSideHover }: ContainerAddHandlesProps) {
    const spots = useMemo(
        () =>
            sides.map(side => {
                const anchor = anchorForSide(container, side)
                const p = isoPosition(anchor.col, anchor.row)
                return {
                    side,
                    left: p.left + worldOffset.left + TILE_W / 2 - HIT_W / 2,
                    top: p.top + worldOffset.top - HIT_H / 2,
                    z: tileZ(anchor.col, anchor.row),
                }
            }),
        [container, sides, worldOffset]
    )

    return (
        <>
            {spots.map(({ side, left, top, z }, i) => (
                <button
                    key={side}
                    type="button"
                    aria-label={label}
                    title={label}
                    className="iso-add-mark absolute flex cursor-pointer items-center justify-center focus-visible:outline-none"
                    data-active={activeSide === side ? '' : undefined}
                    style={{ left, top, width: HIT_W, height: HIT_H, zIndex: z, animationDelay: `${i * 35}ms`, pointerEvents: 'auto' }}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                        e.stopPropagation()
                        onAdd(container.id, side)
                    }}
                    onPointerEnter={() => onSideHover(container.id, side)}
                    onPointerLeave={() => onSideHover(container.id, null)}
                    onFocus={() => onSideHover(container.id, side)}
                    onBlur={() => onSideHover(container.id, null)}
                >
                    <svg className="iso-add-mark-glyph" width={MARK.width} height={MARK.height} viewBox={`${-MARK.width / 2} ${-MARK.height / 2} ${MARK.width} ${MARK.height}`} aria-hidden>
                        <path className="iso-add-mark-plate" d={MARK.plate} />
                        <path className="iso-add-mark-plus" d={MARK.plus} />
                    </svg>
                </button>
            ))}
        </>
    )
})
