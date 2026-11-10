import { KeyboardState, useAnimatedKeyboard, useAnimatedReaction } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

// Android sends keyboardDidShow as the keyboard starts to rise, before useAnimatedKeyboard has lifted
// the conversation: a scroll to the end made then reaches the end of the full-height thread, which the
// lift then shrinks, so the end (a card's buttons under its field) stays behind the keyboard. This waits
// for the keyboard to be fully open, as iOS's keyboardDidShow does.
export function useKeyboardShown(onShown: () => void) {
    const keyboard = useAnimatedKeyboard()
    useAnimatedReaction(
        () => keyboard.state.value === KeyboardState.OPEN,
        (open, wasOpen) => {
            if (open && !wasOpen) scheduleOnRN(onShown)
        }
    )
}
