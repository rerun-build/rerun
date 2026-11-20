import { useEffect, useId } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'

import { BUDDY_FACE_CENTER, BuddyFace, buddyEyeLine } from '@/components/buddy/BuddyFace'
import { useBlinkScale } from '@/components/buddy/motion'
import { ORB_CENTER as CENTER, ORB_RADIUS as RADIUS, advance, layerTransform, restingPose, startClock } from '@/components/orb/orb-motion'

// Ported from packages/ui/src/foreman (Orb, ForemanBall, foreman-face, the `glass` material): the
// Foreman is an indigo glass ball with two round eyes on a dark plate. Like on the web, its eyes
// drift, the ball turns as if looking around, a band of light crosses the glass, and it bounces and
// spins while it thinks.
//
// Whatever moves is a view of its own (the band of light, the face, the eyes on it), drawn once and
// moved by its transform. Moved inside one drawing instead, every frame committed the whole screen's
// tree and painted the ball again, which held the main thread of an iPhone at 95%.

export type OrbState = 'idle' | 'thinking'

const FLOOR = CENTER.y + RADIUS
const MARGIN = 2
const BELOW_FLOOR = 5
const VIEW_WIDTH = RADIUS * 2 + MARGIN * 2
const VIEW_HEIGHT = RADIUS * 2 + MARGIN + BELOW_FLOOR

const SMALL_BELOW = 40
const FACE_SCALE = 1.4
const SMALL_FACE_SCALE = 1.7
const EYE_Y = 10
const FACE_EYE_SHARE = 0.45
const PLATE = { width: 27, height: 14, radius: 6 }
const BLINK_OFFSET = 1.3

// The face is drawn around its own origin, which its matrix then carries over the ball.
const FACE_HALF = 26
const FACE_BOX = `${-FACE_HALF} ${-FACE_HALF} ${FACE_HALF * 2} ${FACE_HALF * 2}`

// The band of light waits left of the ball, leaning, and crosses it from there.
const SHEEN_WIDTH = 20
const SHEEN_SKEW = -18
const SHEEN_X = CENTER.x - RADIUS - SHEEN_WIDTH - 4
const SHEEN_LEAN = Math.tan((SHEEN_SKEW * Math.PI) / 180)
const SHEEN_LEFT = Math.floor(SHEEN_X + SHEEN_LEAN * (CENTER.y + RADIUS))
const SHEEN_SPAN = Math.ceil(SHEEN_X + SHEEN_WIDTH + SHEEN_LEAN * (CENTER.y - RADIUS)) - SHEEN_LEFT
const SHEEN_BOX = `${SHEEN_LEFT} ${CENTER.y - RADIUS} ${SHEEN_SPAN} ${RADIUS * 2}`

const GLASS = {
    stops: [
        [0, '#e3deff'],
        [0.2, '#a99bff'],
        [0.5, '#4d34f7'],
        [0.8, '#2a1ab0'],
        [1, '#120a5c'],
    ] as const,
    bounce: '#9d8eff',
    plate: ['#130b52', '#05021f'] as const,
    eyeTint: '#b9adff',
    eyeLight: '#e3deff',
    topGloss: 0.6,
}

const MOTION: Record<OrbState, { amp: number; period: number }> = {
    idle: { amp: 0, period: 0 },
    thinking: { amp: 0.09, period: 1.1 },
}

type ForemanOrbProps = {
    // Diameter of the ball in points; its shadow spills a little under it.
    size: number
    state?: OrbState
    facing?: 'left' | 'right'
    animated?: boolean
    // Holds the ball still in its resting pose, for one that is out of sight.
    paused?: boolean
    style?: StyleProp<ViewStyle>
}

export function ForemanOrb({ size, state = 'idle', facing = 'left', animated = true, paused = false, style }: ForemanOrbProps) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const reducedMotion = useReducedMotion()
    const small = size < SMALL_BELOW
    const faceScale = small ? SMALL_FACE_SCALE : FACE_SCALE
    const motion = MOTION[state]
    const moving = animated && !reducedMotion && motion.amp > 0

    const phase = useSharedValue(0)
    useEffect(() => {
        if (!moving) {
            cancelAnimation(phase)
            phase.value = 0
            return
        }
        phase.value = withRepeat(withTiming(1, { duration: (motion.period * 1000) / 2, easing: Easing.inOut(Easing.quad) }), -1, true)
    }, [moving, motion.period, phase])

    const living = animated && !paused && !reducedMotion
    const thinking = state === 'thinking'
    const clock = useSharedValue(startClock())
    const pose = useSharedValue(restingPose(facing))
    const lifeInput = useSharedValue({ thinking, facing })
    useEffect(() => {
        lifeInput.value = { thinking, facing }
    }, [thinking, facing, lifeInput])
    const life = useFrameCallback(frame => {
        const dt = Math.min((frame.timeSincePreviousFrame ?? 16) / 1000, 0.05)
        const { thinking: busy, facing: side } = lifeInput.value
        clock.modify(current => {
            'worklet'
            pose.value = advance(current, dt, busy, side)
            return current
        }, false)
    }, false)
    useEffect(() => {
        life.setActive(living)
        // A ball stopped halfway through a spin would be left without a face.
        if (!living) pose.set(restingPose(facing))
    }, [living, facing, life, pose])

    const unit = size / (RADIUS * 2)
    const mood = thinking ? 'working' : 'idle'
    const eyeDepth = EYE_Y / FACE_EYE_SHARE
    const eyeLine = (buddyEyeLine({ mouth: 'none', mood, depth: eyeDepth }) - EYE_Y) * faceScale * unit
    const blink = useBlinkScale(animated && !reducedMotion ? BLINK_OFFSET : null)
    const face = useAnimatedStyle(() => ({ opacity: pose.value.faceShown ? 1 : 0, transform: layerTransform(pose.value.face, unit) }))
    const eyes = useAnimatedStyle(() => {
        const gaze = pose.value.eyes
        return { transform: [{ translateX: gaze[4] * faceScale * unit }, { translateY: gaze[5] * faceScale * unit + eyeLine }, { scaleY: blink.value }, { translateY: -eyeLine }] }
    })
    const sheen = useAnimatedStyle(() => ({ transform: [{ translateX: pose.value.sheen[4] * unit }] }))

    const width = (size * VIEW_WIDTH) / (RADIUS * 2)
    const height = (size * VIEW_HEIGHT) / (RADIUS * 2)
    const bounce = useAnimatedStyle(() => {
        const amp = motion.amp
        const lift = phase.value
        return {
            transform: [
                { translateY: (-lift * amp * 170 * width) / VIEW_WIDTH },
                { scaleX: 1 + amp * 0.7 - lift * amp },
                { scaleY: 1 - amp * 0.7 + lift * amp },
            ],
        }
    })
    const shadow = useAnimatedStyle(() => {
        const amp = motion.amp
        const lift = phase.value
        return { opacity: 1 - lift * 0.45, transform: [{ scale: 1 + amp * 0.7 - lift * amp * 3.7 }] }
    })

    const inset = (size * MARGIN) / (RADIUS * 2)
    const viewBox = `${CENTER.x - VIEW_WIDTH / 2} ${CENTER.y - RADIUS - MARGIN} ${VIEW_WIDTH} ${VIEW_HEIGHT}`
    const sphere = { cx: CENTER.x, cy: CENTER.y, r: RADIUS }
    const plateX = BUDDY_FACE_CENTER - PLATE.width / 2
    const plateTop = EYE_Y - PLATE.height / 2
    const fromFloor: ViewStyle = { position: 'absolute', left: -inset, top: -inset, width, height, transformOrigin: ['50%', `${((FLOOR - (CENTER.y - RADIUS - MARGIN)) / VIEW_HEIGHT) * 100}%`, 0] }
    const faceFrame = `scale(${faceScale}) translate(${-BUDDY_FACE_CENTER} ${-EYE_Y})`
    // Laid out from the ball's own corner, the square its round window cuts.
    const ballWindow: ViewStyle = { position: 'absolute', left: inset, top: inset, width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }
    const sheenBox: ViewStyle = { position: 'absolute', left: (SHEEN_LEFT - (CENTER.x - RADIUS)) * unit, top: 0, width: SHEEN_SPAN * unit, height: size }
    const faceBox: ViewStyle = { position: 'absolute', left: (RADIUS - CENTER.x - FACE_HALF) * unit, top: (RADIUS - CENTER.y - FACE_HALF) * unit, width: FACE_HALF * 2 * unit, height: FACE_HALF * 2 * unit }

    return (
        <View pointerEvents="none" style={[{ width: size, height: size }, style]}>
            <Animated.View style={[fromFloor, shadow]}>
                <Svg viewBox={viewBox} width={width} height={height}>
                    <Defs>
                        <RadialGradient id={`${uid}-shadow`}>
                            <Stop offset="0" stopColor="#000" stopOpacity={0.45} />
                            <Stop offset="1" stopColor="#000" stopOpacity={0} />
                        </RadialGradient>
                    </Defs>
                    <Ellipse cx={CENTER.x} cy={FLOOR} rx={RADIUS * 0.72} ry={BELOW_FLOOR - 1} fill={`url(#${uid}-shadow)`} />
                </Svg>
            </Animated.View>
            <Animated.View style={[fromFloor, bounce]}>
                <Svg viewBox={viewBox} width={width} height={height}>
                    <Defs>
                        <RadialGradient id={`${uid}-body`} cx={CENTER.x - 12} cy={CENTER.y - 16} r={RADIUS * 1.55} gradientUnits="userSpaceOnUse">
                            {GLASS.stops.map(([offset, color]) => (
                                <Stop key={offset} offset={offset} stopColor={color} />
                            ))}
                        </RadialGradient>
                        <RadialGradient id={`${uid}-bounce`} cx={CENTER.x + 16} cy={CENTER.y + 30} r={RADIUS * 0.8} gradientUnits="userSpaceOnUse">
                            <Stop offset="0" stopColor={GLASS.bounce} stopOpacity={0.5} />
                            <Stop offset="1" stopColor={GLASS.bounce} stopOpacity={0} />
                        </RadialGradient>
                    </Defs>
                    <Circle {...sphere} fill={`url(#${uid}-body)`} />
                    <Circle {...sphere} fill={`url(#${uid}-bounce)`} />
                </Svg>

                <View style={ballWindow}>
                    {living && (
                        <Animated.View style={[sheenBox, sheen]}>
                            <Svg viewBox={SHEEN_BOX} width="100%" height="100%">
                                <Defs>
                                    <LinearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
                                        <Stop offset="0" stopColor="#fff" stopOpacity={0} />
                                        <Stop offset="0.5" stopColor="#fff" stopOpacity={0.55} />
                                        <Stop offset="1" stopColor="#fff" stopOpacity={0} />
                                    </LinearGradient>
                                </Defs>
                                <G transform={`skewX(${SHEEN_SKEW})`}>
                                    <Rect x={SHEEN_X} y={CENTER.y - RADIUS} width={SHEEN_WIDTH} height={RADIUS * 2} fill={`url(#${uid}-sheen)`} />
                                </G>
                            </Svg>
                        </Animated.View>
                    )}
                    <Animated.View style={[faceBox, face]}>
                        <Svg viewBox={FACE_BOX} width="100%" height="100%">
                            <Defs>
                                <LinearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
                                    <Stop offset="0" stopColor={GLASS.plate[0]} />
                                    <Stop offset="1" stopColor={GLASS.plate[1]} />
                                </LinearGradient>
                            </Defs>
                            <G transform={faceFrame}>
                                <Rect x={plateX} y={plateTop + 0.7} width={PLATE.width} height={PLATE.height} rx={PLATE.radius} fill="#fff" fillOpacity={0.45} />
                                <Rect x={plateX} y={plateTop} width={PLATE.width} height={PLATE.height} rx={PLATE.radius} fill={`url(#${uid}-plate)`} />
                                <Rect x={plateX + 2} y={plateTop + 1.2} width={PLATE.width - 4} height={PLATE.height * 0.4} rx={PLATE.radius - 2} fill="#fff" fillOpacity={0.07} />
                            </G>
                        </Svg>
                        <Animated.View style={[StyleSheet.absoluteFill, eyes]}>
                            <Svg viewBox={FACE_BOX} width="100%" height="100%">
                                <G transform={faceFrame}>
                                    <BuddyFace uid={uid} eyes="round" mouth="none" mood={mood} depth={eyeDepth} light={GLASS.eyeLight} lit={!small} tint={GLASS.eyeTint} />
                                </G>
                            </Svg>
                        </Animated.View>
                    </Animated.View>
                </View>

                <Svg viewBox={viewBox} width={width} height={height} style={StyleSheet.absoluteFill}>
                    <Defs>
                        <LinearGradient id={`${uid}-gloss`} x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor="#fff" stopOpacity={Math.min(1, GLASS.topGloss + 0.3)} />
                            <Stop offset="1" stopColor="#fff" stopOpacity={0} />
                        </LinearGradient>
                        <ClipPath id={`${uid}-gloss-clip`}>
                            <Circle {...sphere} />
                        </ClipPath>
                    </Defs>
                    <G clipPath={`url(#${uid}-gloss-clip)`}>
                        <Ellipse cx={CENTER.x - 13} cy={CENTER.y - 24} rx={17} ry={8.5} transform={`rotate(-24 ${CENTER.x - 13} ${CENTER.y - 24})`} fill={`url(#${uid}-gloss)`} />
                    </G>
                    <Circle {...sphere} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={0.7} />
                </Svg>
            </Animated.View>
        </View>
    )
}

