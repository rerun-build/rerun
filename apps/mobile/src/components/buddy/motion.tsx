import { createContext, use, type ReactNode } from 'react'
import { interpolate, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated'

// One clock for every buddy on screen, in seconds. Each buddy reads it with its own offset, so a
// list of them never bobs nor blinks in step.
const Clock = createContext<SharedValue<number> | null>(null)

// A buddy moves 60 times a second at most: on a 120 Hz screen the frame in between is one nobody
// sees, and it costs as much as the other.
const TICK_SECONDS = 1 / 60
const TICK_SLACK = 0.002

// `resting`: true while the buddies under this clock are out of sight (a screen covered by another):
// the clock stands still, and nothing drawn from it moves on the UI thread.
export function BuddyClock({ children, resting }: { children: ReactNode; resting?: SharedValue<boolean> }) {
    const seconds = useSharedValue(0)
    const reducedMotion = useReducedMotion()
    useFrameCallback(frame => {
        if (resting?.value) return
        const now = frame.timeSinceFirstFrame / 1000
        if (now - seconds.value < TICK_SECONDS - TICK_SLACK) return
        seconds.value = now
    }, !reducedMotion)
    return <Clock value={reducedMotion ? null : seconds}>{children}</Clock>
}

// The clock itself, for whatever moves with the buddies and stops with them. Null when nothing moves.
export function useBuddyClock() {
    return use(Clock)
}

export type BuddyMotion = { kind: 'bob' | 'shudder' | null; offset: number; blinkOffset: number }

// The web keyframes iso-buddy-bob-wall and iso-buddy-shudder-wall: how tall the walls stand, the
// top riding on them.
const BOB = { period: 1.2, at: [0, 0.35, 0.62, 0.78, 1], stretch: [1, 1.2, 0.92, 1.02, 1] }
const SHUDDER = { period: 2.4, at: [0, 0.6, 0.66, 0.72, 0.78, 0.84, 1], stretch: [1, 1, 0.9, 1.06, 0.95, 1.02, 1] }
const BLINK = { period: 4.6, at: [0, 0.92, 0.95, 1], scale: [1, 1, 0.08, 1] }
const SWEEP_PERIOD = 2.6

// Each of these is a value read off the clock, for a view to move by its transform. A value that
// stands still is not handed the clock at all: holding it would run its worklet on every frame. One
// that keeps its value between two frames wakes nothing that reads it.

// How tall the walls stand, 1 at rest.
export function useStretch(motion: BuddyMotion | null) {
    const clock = use(Clock)
    const keys = motion?.kind === 'bob' ? BOB : motion?.kind === 'shudder' ? SHUDDER : null
    const offset = motion?.offset ?? 0
    const ticking = keys ? clock : null
    return useDerivedValue(() => {
        if (!ticking || !keys) return 1
        const phase = ((ticking.value + offset) % keys.period) / keys.period
        return interpolate(phase, keys.at, keys.stretch)
    })
}

// How open the eyes stand, 1 until they blink: `offset` keeps two faces from blinking together, null
// holds them open.
export function useBlinkScale(offset: number | null) {
    const clock = use(Clock)
    const ticking = offset === null ? null : clock
    return useDerivedValue(() => {
        if (!ticking || offset === null) return 1
        const phase = ((ticking.value + offset) % BLINK.period) / BLINK.period
        return interpolate(phase, BLINK.at, BLINK.scale)
    })
}

// How far the band of light has crossed the top of a buddy at work, from 0 to 1.
export function useSweep(working: boolean) {
    const clock = use(Clock)
    const ticking = working ? clock : null
    return useDerivedValue(() => {
        if (!ticking) return 0
        const phase = (ticking.value % SWEEP_PERIOD) / SWEEP_PERIOD
        return phase < 0.5 ? 2 * phase * phase : 1 - (-2 * phase + 2) ** 2 / 2
    })
}
