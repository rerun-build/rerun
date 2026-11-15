'use client'

import { memo, useMemo } from 'react'
import { containerDiamond } from '../iso'

type ContainerDrawPreviewProps = {
    start: { col: number; row: number }
    end: { col: number; row: number }
    worldOffset: { left: number; top: number }
    color: string
    animated?: boolean
}

export const ContainerDrawPreview = memo(function ContainerDrawPreview({ start, end, worldOffset, color, animated }: ContainerDrawPreviewProps) {
    const { path, bounds } = useMemo(
        () => containerDiamond({ col_start: start.col, row_start: start.row, col_end: end.col, row_end: end.row }, worldOffset),
        [start.col, start.row, end.col, end.row, worldOffset]
    )

    const isNeutral = color.toLowerCase() === '#ffffff' || color.toLowerCase() === '#fff'

    if (bounds.width === 0 && bounds.height === 0) return null

    return (
        <svg
            className="absolute pointer-events-none"
            style={{
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
                zIndex: 99998,
                overflow: 'visible',
            }}
            viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        >
            <path
                className={animated ? 'iso-draw-preview-dash' : undefined}
                d={path}
                fill={isNeutral ? 'rgb(var(--iso-glint) / 0.06)' : color + '20'}
                stroke={isNeutral ? 'var(--iso-outline-hot)' : color}
                strokeWidth={2}
                strokeDasharray="6 5"
                strokeOpacity={0.8}
            />
        </svg>
    )
})
