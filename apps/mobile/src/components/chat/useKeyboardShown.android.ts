import { KeyboardState, useAnimatedKeyboard, useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

export function useKeyboardShown(onShown: () => void) {
    const keyboard = useAnimatedKeyboard()
    useAnimatedReaction(
        () => keyboard.state.value === KeyboardState.OPEN,
        (open, wasOpen) => {
            if (open && !wasOpen) scheduleOnRN(onShown)
        }
    )
}
