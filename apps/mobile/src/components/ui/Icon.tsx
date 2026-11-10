import { ICONS } from '@rerun/cloud-mobile/icons'
import { useId } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import Svg, { Circle, Defs, Ellipse, G, Line, Mask, Path, Polygon, Polyline, Rect } from 'react-native-svg'

import type { IconShape, IconShapeTag } from '@/components/ui/icon-glyph'
import type { IconName } from '@/components/ui/icon-names'

export type { IconName } from '@/components/ui/icon-names'

type IconProps = {
    name: IconName
    size?: number
    color: string
    // Nucleo's color-2: the accent stroke of a two-tone glyph.
    secondaryColor?: string
    // A heavier stroke, for a glyph that sits on a filled button.
    bold?: boolean
    accessibilityLabel?: string
    style?: StyleProp<ViewStyle>
}

const SHAPES: Record<IconShapeTag, typeof Path> = {
    path: Path,
    circle: Circle as unknown as typeof Path,
    ellipse: Ellipse as unknown as typeof Path,
    rect: Rect as unknown as typeof Path,
    line: Line as unknown as typeof Path,
    polyline: Polyline as unknown as typeof Path,
    polygon: Polygon as unknown as typeof Path,
}

const BOLD = 1.25

function paintOf(shape: IconShape, color: string, secondaryColor: string, strokeWidth: number) {
    const paint = shape[2]
    const ink = paint.endsWith('2') ? secondaryColor : color
    return { stroke: paint.includes('s') ? ink : 'none', fill: paint.includes('f') ? ink : 'none', strokeWidth }
}

function shapeElement(shape: IconShape, key: number, paint: { stroke: string; fill: string; strokeWidth: number }) {
    const Shape = SHAPES[shape[0]]
    return <Shape key={key} {...(shape[1] as object)} {...paint} strokeLinecap="round" strokeLinejoin="round" />
}

// An icon of the app, the same on iOS and Android: Nucleo in Rerun Cloud, lucide in a self-hosted
// build (`@rerun/cloud-mobile/icons`), drawn by react-native-svg.
export function Icon({ name, size = 18, color, secondaryColor = color, bold = false, accessibilityLabel, style }: IconProps) {
    const maskId = `icon${useId().replace(/[^a-zA-Z0-9]/g, '')}`
    const glyph = ICONS[name]
    const strokeWidth = glyph.stroke * (bold ? BOLD : 1)
    const cutouts = glyph.shapes.filter((shape) => shape[2].endsWith('x'))
    const drawn = glyph.shapes.filter((shape) => !shape[2].endsWith('x'))
    return (
        <Svg
            width={size}
            height={size}
            viewBox={`0 0 ${glyph.box} ${glyph.box}`}
            style={style}
            accessible={accessibilityLabel !== undefined}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityLabel ? 'image' : undefined}
            pointerEvents="none"
        >
            {cutouts.length > 0 && (
                <Defs>
                    <Mask id={maskId} x={0} y={0} width={glyph.box} height={glyph.box} maskUnits="userSpaceOnUse">
                        <Rect x={0} y={0} width={glyph.box} height={glyph.box} fill="#ffffff" />
                        {cutouts.map((shape, index) => shapeElement(shape, index, paintOf(shape, '#000000', '#000000', strokeWidth)))}
                    </Mask>
                </Defs>
            )}
            <G mask={cutouts.length > 0 ? `url(#${maskId})` : undefined}>{drawn.map((shape, index) => shapeElement(shape, index, paintOf(shape, color, secondaryColor, strokeWidth)))}</G>
        </Svg>
    )
}
