import { useEffect, useState } from 'react'
import { Dimensions, Keyboard, type KeyboardEvent, type KeyboardMetrics } from 'react-native'
import { KeyboardState, useAnimatedKeyboard, useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { spacing } from '@/theme/tokens'

// iOS gives the keyboard frame in screen coordinates. An iPad window smaller than the screen (Stage
// Manager, Slide Over) does not end at the screen's bottom, so there the height stays Reanimated's,
// which converts the frame into the window. An empty frame (cross-fade transitions, a floating keyboard)
// is a keyboard that covers nothing.
function visibleHeight(frame: KeyboardMetrics | null | undefined): number | null {
    const screen = Dimensions.get('screen')
    if (Dimensions.get('window').height !== screen.height) return null
    return frame && frame.height > 0 ? Math.max(0, screen.height - frame.screenY) : 0
}

// Reanimated reads the height of a keyboard at rest off the keyboard view it found the first time and
// kept: once iOS swaps that view (back from the background, another window), it reads 0 and the field
// sits behind the keyboard (RER-68), or the old height and the field floats once it is gone (RER-72).
// At rest, the height is the frame iOS announced for the move. Reanimated's animation drives the moves
// when it runs; on a stale view it does not, and the field goes to the announced height in one step.
export function useKeyboardHeight() {
    const keyboard = useAnimatedKeyboard()
    const announced = useSharedValue(visibleHeight(Keyboard.isVisible() ? Keyboard.metrics() : undefined))
    useEffect(() => {
        const announce = (event: KeyboardEvent) => {
            announced.value = visibleHeight(event.endCoordinates)
        }
        const subscriptions = [Keyboard.addListener('keyboardWillShow', announce), Keyboard.addListener('keyboardWillHide', announce), Keyboard.addListener('keyboardWillChangeFrame', announce)]
        return () => subscriptions.forEach(subscription => subscription.remove())
    }, [announced])
    const height = useDerivedValue(() => {
        const moving = keyboard.state.value === KeyboardState.OPENING || keyboard.state.value === KeyboardState.CLOSING
        return moving || announced.value === null ? keyboard.height.value : announced.value
    })
    return { height }
}

// A chat slides up with the keyboard rather than shrinking: a transform moves it on the UI thread,
// where a padding would lay the whole thread out again at every frame of the keyboard's move.
export const LIFTS_BY_SLIDING = true

const raiseOf = (keyboardHeight: number, bottomInset: number) => {
    'worklet'
    return Math.max(keyboardHeight + spacing.sm, bottomInset) - bottomInset
}

export function useKeyboardLift(height: SharedValue<number>, bottomInset: number) {
    return useAnimatedStyle(() => ({ transform: [{ translateY: -raiseOf(height.value, bottomInset) }] }))
}

// How far the chat stands raised once the keyboard is at rest: the top of its thread is that much
// under the header, and the thread scrolls that much further to bring it back.
export function useRaiseAtRest(bottomInset: number): number {
    // A chat opened while the keyboard is up (a page picked from the header's menu) starts raised.
    const [raised, setRaised] = useState(() => {
        const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined
        return metrics ? raiseOf(visibleHeight(metrics) ?? metrics.height, bottomInset) : 0
    })
    useEffect(() => {
        const shown = Keyboard.addListener('keyboardDidShow', event => setRaised(raiseOf(visibleHeight(event.endCoordinates) ?? event.endCoordinates.height, bottomInset)))
        const hidden = Keyboard.addListener('keyboardDidHide', () => setRaised(0))
        return () => {
            shown.remove()
            hidden.remove()
        }
    }, [bottomInset])
    return raised
}
