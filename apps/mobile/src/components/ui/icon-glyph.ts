import type { IconName } from '@/components/ui/icon-names'

export type IconShapeTag = 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'polyline' | 'polygon'

// 's' stroked, 'f' filled, 'sf' both; a trailing '2' marks a secondary shape, a trailing 'x' a shape a
// solid glyph punches through its filled shapes.
export type IconPaint = 's' | 'f' | 'sf' | 's2' | 'f2' | 'sf2' | 'sx' | 'fx' | 'sfx'

export type IconShape = readonly [tag: IconShapeTag, geometry: Readonly<Record<string, string | number>>, paint: IconPaint]

// `box` is the side of the square viewBox, `stroke` the stroke width the set is drawn with, in viewBox units.
export type IconGlyph = { readonly box: number; readonly stroke: number; readonly shapes: readonly IconShape[] }

export type IconSet = Readonly<Record<IconName, IconGlyph>>
