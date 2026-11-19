import { useAnimatedKeyboard, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { spacing } from '@/theme/tokens'

// Android measures the keyboard from its window insets, never from a cached keyboard view: Reanimated's
// height is right at rest there.
export function useKeyboardHeight() {
    return useAnimatedKeyboard()
}

// Android has no scroll inset to give back the top of a slid thread: the chat makes room for the
// keyboard by its padding.
export const LIFTS_BY_SLIDING = false

export function useKeyboardLift(height: SharedValue<number>, bottomInset: number, _slides = true) {
    return useAnimatedStyle(() => ({ paddingBottom: Math.max(height.value + spacing.sm, bottomInset) }))
}

export function useRaiseAtRest(_bottomInset: number): number {
    return 0
}
