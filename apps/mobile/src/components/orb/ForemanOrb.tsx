import { useEffect, useId, type ComponentType } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, RadialGradient, Rect, Stop, type GProps } from 'react-native-svg'

import { BUDDY_FACE_CENTER, BuddyFace } from '@/components/buddy/BuddyFace'
import { BuddyMotionScope } from '@/components/buddy/motion'
import { ORB_CENTER as CENTER, ORB_RADIUS as RADIUS, advance, restingPose, startClock, type Matrix } from '@/components/orb/orb-motion'

export type OrbState = 'idle' | 'thinking'

const AnimatedG = Animated.createAnimatedComponent(G as ComponentType<GProps & { matrix?: Matrix }>)

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
const SHEEN_WIDTH = 20

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
    size: number
    state?: OrbState
    facing?: 'left' | 'right'
    animated?: boolean
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
        if (!living) pose.set(restingPose(facing))
    }, [living, facing, life, pose])

    const faceProps = useAnimatedProps(() => ({ matrix: pose.value.face, opacity: pose.value.faceShown ? 1 : 0 }))
    const eyesProps = useAnimatedProps(() => ({ matrix: pose.value.eyes }))
    const sheenProps = useAnimatedProps(() => ({ matrix: pose.value.sheen }))

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
                        <LinearGradient id={`${uid}-gloss`} x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor="#fff" stopOpacity={Math.min(1, GLASS.topGloss + 0.3)} />
                            <Stop offset="1" stopColor="#fff" stopOpacity={0} />
                        </LinearGradient>
                        <LinearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
                            <Stop offset="0" stopColor="#fff" stopOpacity={0} />
                            <Stop offset="0.5" stopColor="#fff" stopOpacity={0.55} />
                            <Stop offset="1" stopColor="#fff" stopOpacity={0} />
                        </LinearGradient>
                        <LinearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={GLASS.plate[0]} />
                            <Stop offset="1" stopColor={GLASS.plate[1]} />
                        </LinearGradient>
                        <ClipPath id={`${uid}-clip`}>
                            <Circle {...sphere} />
                        </ClipPath>
                    </Defs>

                    <Circle {...sphere} fill={`url(#${uid}-body)`} />
                    <G clipPath={`url(#${uid}-clip)`}>
                        <Circle {...sphere} fill={`url(#${uid}-bounce)`} />
                        {living && (
                            <G transform="skewX(-18)">
                                <AnimatedG animatedProps={sheenProps}>
                                    <Rect x={CENTER.x - RADIUS - SHEEN_WIDTH - 4} y={CENTER.y - RADIUS} width={SHEEN_WIDTH} height={RADIUS * 2} fill={`url(#${uid}-sheen)`} />
                                </AnimatedG>
                            </G>
                        )}
                        <AnimatedG animatedProps={faceProps}>
                            <G transform={`scale(${faceScale}) translate(${-BUDDY_FACE_CENTER} ${-EYE_Y})`}>
                                <Rect x={plateX} y={plateTop + 0.7} width={PLATE.width} height={PLATE.height} rx={PLATE.radius} fill="#fff" fillOpacity={0.45} />
                                <Rect x={plateX} y={plateTop} width={PLATE.width} height={PLATE.height} rx={PLATE.radius} fill={`url(#${uid}-plate)`} />
                                <Rect x={plateX + 2} y={plateTop + 1.2} width={PLATE.width - 4} height={PLATE.height * 0.4} rx={PLATE.radius - 2} fill="#fff" fillOpacity={0.07} />
                                <AnimatedG animatedProps={eyesProps}>
                                    <BuddyMotionScope motion={animated && !reducedMotion ? { kind: null, offset: 0, blinkOffset: 1.3 } : null}>
                                        <BuddyFace uid={uid} eyes="round" mouth="none" mood={thinking ? 'working' : 'idle'} depth={EYE_Y / FACE_EYE_SHARE} light={GLASS.eyeLight} lit={!small} tint={GLASS.eyeTint} />
                                    </BuddyMotionScope>
                                </AnimatedG>
                            </G>
                        </AnimatedG>
                        <Ellipse cx={CENTER.x - 13} cy={CENTER.y - 24} rx={17} ry={8.5} transform={`rotate(-24 ${CENTER.x - 13} ${CENTER.y - 24})`} fill={`url(#${uid}-gloss)`} />
                    </G>
                    <Circle {...sphere} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={0.7} />
                </Svg>
            </Animated.View>
        </View>
    )
}

