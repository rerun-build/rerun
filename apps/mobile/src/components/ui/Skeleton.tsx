import { useEffect } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { useTheme } from '@/theme/theme'
import { radius } from '@/theme/tokens'

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
    const theme = useTheme()
    const reducedMotion = useReducedMotion()
    const pulse = useSharedValue(1)

    useEffect(() => {
        if (reducedMotion) return
        pulse.value = withRepeat(withTiming(0.5, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true)
        return () => cancelAnimation(pulse)
    }, [pulse, reducedMotion])
    const fade = useAnimatedStyle(() => ({ opacity: pulse.value }))

    return <Animated.View style={[{ borderRadius: radius.sm, borderCurve: 'continuous', backgroundColor: theme.muted }, style, fade]} />
}
