import { useId } from 'react'
import { View } from 'react-native'
import Svg, { Defs, Mask, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'

import { BorderBeam } from '@/components/ui/BorderBeam'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { mix } from '@/theme/tokens'

const TILE = 32
const CORNER = 10
const CELL = 8
const GLYPH = 14
const ORANGE = '#f97316'
const INNER = TILE - 2

// A CSS `circle` radial gradient reaches the farthest corner, half the box's diagonal.
const REACH = (INNER / 2) * Math.SQRT2

// The web's `--icon-glint*` and `--icon-grid-opacity`.
const GLINT = { light: { color: '#000000', core: 0.05, halo: 0.012, grid: 0.15 }, dark: { color: '#ffffff', core: 0.18, halo: 0.04, grid: 0.25 } } as const

export type IconTileTone = 'neutral' | 'orange'

// Same hash as the web `Icon`: two tiles side by side do not carry the same beam.
function beamAngleFrom(id: string) {
    let hash = 0
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return Math.abs(hash) % 360
}

function GridAndGlint({ id }: { id: string }) {
    const theme = useTheme()
    const glint = GLINT[theme.scheme]
    return (
        <Svg width={INNER} height={INNER}>
            <Defs>
                <Pattern id={`${id}grid`} width={CELL} height={CELL} patternUnits="userSpaceOnUse">
                    <Path d={`M ${CELL} 0 L 0 0 L 0 ${CELL}`} fill="none" stroke={theme.foreground} strokeWidth={0.5} />
                </Pattern>
                <RadialGradient id={`${id}fade`} cx={INNER / 2} cy={INNER / 2} r={REACH} gradientUnits="userSpaceOnUse">
                    <Stop offset={0} stopColor="#ffffff" stopOpacity={1} />
                    <Stop offset={0.78} stopColor="#ffffff" stopOpacity={0} />
                </RadialGradient>
                <Mask id={`${id}mask`}>
                    <Rect width={INNER} height={INNER} fill={`url(#${id}fade)`} />
                </Mask>
                <RadialGradient id={`${id}glint`} cx={INNER / 2} cy={INNER / 2} r={REACH} gradientUnits="userSpaceOnUse">
                    <Stop offset={0} stopColor={glint.color} stopOpacity={glint.core} />
                    <Stop offset={0.45} stopColor={glint.color} stopOpacity={glint.halo} />
                    <Stop offset={0.7} stopColor={glint.color} stopOpacity={0} />
                </RadialGradient>
            </Defs>
            <Rect width={INNER} height={INNER} fill={`url(#${id}grid)`} opacity={glint.grid} mask={`url(#${id}mask)`} />
            <Rect width={INNER} height={INNER} fill={`url(#${id}glint)`} />
        </Svg>
    )
}

// Port of the web `<Icon size="sm">`: a small box whose border is a static beam, a
// faint grid fading out from the center and a soft glint behind the glyph.
export function IconTile({ symbol, tone = 'neutral' }: { symbol: IconName; tone?: IconTileTone }) {
    const theme = useTheme()
    const id = useId().replace(/[^a-zA-Z0-9]/g, '')
    const surface = tone === 'orange' ? mix(theme.card, ORANGE, 0.1) : mix(theme.card, theme.primary, 0.05)
    return (
        <View style={{ width: TILE, height: TILE, borderRadius: CORNER, borderCurve: 'continuous', borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            <BorderBeam tone={tone} radius={CORNER} surface={surface} animated={false} angle={beamAngleFrom(id)} />
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, borderRadius: CORNER - 1, borderCurve: 'continuous', overflow: 'hidden' }}>
                <GridAndGlint id={id} />
            </View>
            <Icon name={symbol} size={GLYPH} color={theme.foreground} />
        </View>
    )
}
