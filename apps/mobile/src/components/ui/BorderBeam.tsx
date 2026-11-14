import { useEffect, useMemo, useState } from 'react'
import { Animated, Easing, View, type LayoutChangeEvent } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'

import { useTheme } from '@/theme/theme'
import { mix } from '@/theme/tokens'

// Port of the web `BorderBeam` arcs (packages/ui/src/BorderBeam.tsx): a conic gradient with two
// opposite arcs spins behind the card, and the card's surface covers all of it but a 1px ring. The
// gradient is drawn once and only its rotation runs, on the native driver: Reanimated commits the shadow
// tree every frame and cost ~4% CPU per card, the native driver touches the view alone.
const BEAM_COLORS = {
    brand: '#b7a8ff',
    orange: '#f97316',
} as const

export type BeamTone = keyof typeof BEAM_COLORS | 'neutral'

const HALF_TURN_MS = 3500
const STEP_DEGREES = 2
const REST_SHARE = 0.2
const ARC_STOPS: [number, number][] = [
    [0, REST_SHARE],
    [0.1, 1],
    [0.22, REST_SHARE],
]

// The web arcs: `beam-2 0%, beam-1 10%, beam-2 22%`, then the same half a turn later.
function shareAt(turn: number) {
    const within = turn % 0.5
    for (let i = 1; i < ARC_STOPS.length; i++) {
        const [to, toShare] = ARC_STOPS[i]
        const [from, fromShare] = ARC_STOPS[i - 1]
        if (within <= to) return fromShare + ((within - from) / (to - from)) * (toShare - fromShare)
    }
    return REST_SHARE
}

function wedge(center: number, reach: number, fromDegrees: number, toDegrees: number) {
    const point = (degrees: number) => {
        const radians = ((degrees - 90) * Math.PI) / 180
        return `${center + reach * Math.cos(radians)} ${center + reach * Math.sin(radians)}`
    }
    return `M ${center} ${center} L ${point(fromDegrees)} L ${point(toDegrees)} Z`
}

function ConicArcs({ side, beam, rest }: { side: number; beam: string; rest: string }) {
    const center = side / 2
    const wedges = useMemo(() => {
        const arcEnd = ARC_STOPS[ARC_STOPS.length - 1][0] * 360
        const shapes: { d: string; fill: string }[] = []
        for (const half of [0, 180]) {
            for (let degrees = 0; degrees < arcEnd; degrees += STEP_DEGREES) {
                const share = shareAt((degrees + STEP_DEGREES / 2) / 360)
                shapes.push({ d: wedge(center, center, half + degrees, half + degrees + STEP_DEGREES + 0.5), fill: mix(rest, beam, share) })
            }
        }
        return shapes
    }, [center, beam, rest])
    return (
        <Svg width={side} height={side}>
            <Circle cx={center} cy={center} r={center} fill={mix(rest, beam, REST_SHARE)} />
            {wedges.map((shape, index) => (
                <Path key={index} d={shape.d} fill={shape.fill} />
            ))}
        </Svg>
    )
}

// The web's neutral arcs are the foreground at a low alpha over the surface: 40% / 8% in light, 55% / 10% in dark.
const NEUTRAL_SHARES = { light: { beam: 0.4, rest: 0.08 }, dark: { beam: 0.55, rest: 0.1 } } as const

// First child of a card with a 1px border: it repaints the card's `surface` and turns its border into
// the beam. `radius` is the card's border radius. A static beam stays at `angle`, as the web's.
export function BorderBeam({ tone = 'brand', radius, surface, animated = true, angle = 220 }: { tone?: BeamTone; radius: number; surface: string; animated?: boolean; angle?: number }) {
    const theme = useTheme()
    const reduceMotion = useReducedMotion()
    const [turn] = useState(() => new Animated.Value(0))
    const [size, setSize] = useState<{ width: number; height: number } | null>(null)
    const neutral = NEUTRAL_SHARES[theme.scheme]
    const rest = tone === 'neutral' ? mix(surface, theme.foreground, neutral.rest) : theme.border.startsWith('#') ? theme.border : mix(surface, '#ffffff', 0.1)
    const beam = tone === 'neutral' ? mix(surface, theme.foreground, neutral.beam) : BEAM_COLORS[tone]

    useEffect(() => {
        if (reduceMotion || !animated) return
        const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: HALF_TURN_MS, easing: Easing.bezier(0.6, 0, 0.4, 1), useNativeDriver: true }))
        loop.start()
        return () => loop.stop()
    }, [turn, reduceMotion, animated])

    const spin = { transform: [{ rotate: animated ? turn.interpolate({ inputRange: [0, 1], outputRange: ['220deg', '400deg'] }) : `${angle}deg` }] }

    const onLayout = ({ nativeEvent }: LayoutChangeEvent) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
    const side = size ? Math.ceil(Math.hypot(size.width, size.height)) + 2 : 0

    return (
        <>
            <View pointerEvents="none" onLayout={onLayout} style={{ position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' }}>
                {size && (
                    <Animated.View style={[{ position: 'absolute', width: side, height: side, left: (size.width - side) / 2, top: (size.height - side) / 2 }, spin]}>
                        <ConicArcs side={side} beam={beam} rest={rest} />
                    </Animated.View>
                )}
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius - 1, borderCurve: 'continuous', backgroundColor: surface }} />
        </>
    )
}
