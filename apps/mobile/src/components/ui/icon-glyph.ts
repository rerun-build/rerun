import type { IconName } from '@/components/ui/icon-names'

export type IconShapeTag = 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'polyline' | 'polygon'

export type IconPaint = 's' | 'f' | 'sf' | 's2' | 'f2' | 'sf2' | 'sx' | 'fx' | 'sfx'

export type IconShape = readonly [tag: IconShapeTag, geometry: Readonly<Record<string, string | number>>, paint: IconPaint]

export type IconGlyph = { readonly box: number; readonly stroke: number; readonly shapes: readonly IconShape[] }

export type IconSet = Readonly<Record<IconName, IconGlyph>>
