import { createContext, use, type ComponentType, type ReactNode } from 'react'
import Animated, { interpolate, useAnimatedProps, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { G, Rect, type GProps } from 'react-native-svg'

import { liftedBy, stretchedFrom } from './wall-motion'

const AnimatedMatrixG = Animated.createAnimatedComponent(G as ComponentType<GProps & { matrix?: number[] }>)
const AnimatedRect = Animated.createAnimatedComponent(Rect)

const Clock = createContext<SharedValue<number> | null>(null)

export function BuddyClock({ children }: { children: ReactNode }) {
    const seconds = useSharedValue(0)
    const reducedMotion = useReducedMotion()
    useFrameCallback(frame => {
        seconds.value = frame.timeSinceFirstFrame / 1000
    }, !reducedMotion)
    return <Clock value={reducedMotion ? null : seconds}>{children}</Clock>
}

export type BuddyMotion = { kind: 'bob' | 'shudder' | null; offset: number; blinkOffset: number }

const Motion = createContext<BuddyMotion | null>(null)

export function BuddyMotionScope({ motion, children }: { motion: BuddyMotion | null; children: ReactNode }) {
    return <Motion value={motion}>{children}</Motion>
}

const BOB = { period: 1.2, at: [0, 0.35, 0.62, 0.78, 1], stretch: [1, 1.2, 0.92, 1.02, 1] }
const SHUDDER = { period: 2.4, at: [0, 0.6, 0.66, 0.72, 0.78, 0.84, 1], stretch: [1, 1, 0.9, 1.06, 0.95, 1.02, 1] }
const BLINK = { period: 4.6, at: [0, 0.92, 0.95, 1], scale: [1, 1, 0.08, 1] }
const SWEEP_PERIOD = 2.6

function useStretch() {
    const clock = use(Clock)
    const motion = use(Motion)
    const keys = motion?.kind === 'bob' ? BOB : motion?.kind === 'shudder' ? SHUDDER : null
    const offset = motion?.offset ?? 0
    const stretch = () => {
        'worklet'
        if (!clock || !keys) return 1
        const phase = ((clock.value + offset) % keys.period) / keys.period
        return interpolate(phase, keys.at, keys.stretch)
    }
    return { stretch, still: !clock || !keys }
}

export function GrowsFrom({ y, children }: { y: number; children: ReactNode }) {
    const { stretch, still } = useStretch()
    const animatedProps = useAnimatedProps(() => ({ matrix: stretchedFrom(y, stretch()) }))
    if (still) return <G>{children}</G>
    return <AnimatedMatrixG animatedProps={animatedProps}>{children}</AnimatedMatrixG>
}

export function RidesOnWalls({ depth, children }: { depth: number; children: ReactNode }) {
    const { stretch, still } = useStretch()
    const animatedProps = useAnimatedProps(() => ({ matrix: liftedBy((1 - stretch()) * depth) }))
    if (still) return <G>{children}</G>
    return <AnimatedMatrixG animatedProps={animatedProps}>{children}</AnimatedMatrixG>
}

export function Blinking({ y, children }: { y: number; children: ReactNode }) {
    const clock = use(Clock)
    const motion = use(Motion)
    const offset = motion?.blinkOffset ?? 0
    const animatedProps = useAnimatedProps(() => {
        if (!clock || !motion) return { matrix: stretchedFrom(y, 1) }
        const phase = ((clock.value + offset) % BLINK.period) / BLINK.period
        return { matrix: stretchedFrom(y, interpolate(phase, BLINK.at, BLINK.scale)) }
    })
    if (!clock || !motion) return <G>{children}</G>
    return <AnimatedMatrixG animatedProps={animatedProps}>{children}</AnimatedMatrixG>
}

export function Sweep({ x, y, width, height, fill }: { x: number; y: number; width: number; height: number; fill: string }) {
    const clock = use(Clock)
    const motion = use(Motion)
    const animatedProps = useAnimatedProps(() => {
        if (!clock || !motion) return { x: x - 60 }
        const phase = (clock.value % SWEEP_PERIOD) / SWEEP_PERIOD
        const eased = phase < 0.5 ? 2 * phase * phase : 1 - (-2 * phase + 2) ** 2 / 2
        return { x: x - 60 + eased * 160 }
    })
    return <AnimatedRect animatedProps={animatedProps} y={y} width={width} height={height} fill={fill} />
}
