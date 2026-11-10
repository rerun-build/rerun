import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated'

// Android's "Remove animations" turns the system animator off as well as asking for reduced motion, and
// with both, Reanimated's reduced-motion path leaves a view that mounts with an entering animation
// invisible: the steps of the sign-in sheet rendered blank. Its animations run on its own clock, so they
// still finish there.
export function ReducedMotionOverride() {
    return <ReducedMotionConfig mode={ReduceMotion.Never} />
}
