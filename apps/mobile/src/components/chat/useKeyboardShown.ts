import { useEffect } from 'react'
import { Keyboard } from 'react-native'

export function useKeyboardShown(onShown: () => void) {
    useEffect(() => {
        const subscription = Keyboard.addListener('keyboardDidShow', onShown)
        return () => subscription.remove()
    }, [onShown])
}
