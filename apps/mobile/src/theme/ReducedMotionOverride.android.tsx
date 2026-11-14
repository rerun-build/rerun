import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated'

export function ReducedMotionOverride() {
    return <ReducedMotionConfig mode={ReduceMotion.Never} />
}
