import { useEffect } from 'react'
import { Keyboard } from 'react-native'

// Calls back once the keyboard is fully up, when the conversation lifted above it has its final height.
export function useKeyboardShown(onShown: () => void) {
    useEffect(() => {
        const subscription = Keyboard.addListener('keyboardDidShow', onShown)
        return () => subscription.remove()
    }, [onShown])
}
