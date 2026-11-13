import { useAnimatedKeyboard } from 'react-native-reanimated'

// Android measures the keyboard from its window insets, never from a cached keyboard view: Reanimated's
// height is right at rest there.
export function useKeyboardHeight() {
    return useAnimatedKeyboard()
}
