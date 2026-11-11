import { renderHook } from '@testing-library/react-native'
import { Keyboard, Platform } from 'react-native'
import { KeyboardState } from 'react-native-reanimated'

import { useKeyboardShown } from '@/components/chat/useKeyboardShown'

const mockKeyboardState = { value: KeyboardState.UNKNOWN }
let mockReaction: { prepare: () => boolean; react: (open: boolean, wasOpen: boolean | null) => void; last: boolean | null } | null = null

jest.mock('react-native-reanimated', () => ({
    ...jest.requireActual('react-native-reanimated/mock'),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: mockKeyboardState }),
    useAnimatedReaction: (prepare: () => boolean, react: (open: boolean, wasOpen: boolean | null) => void) => {
        mockReaction = { prepare, react, last: mockReaction?.last ?? null }
    },
}))

// The worklet calls back on the React Native thread, a microtask in Jest.
async function keyboardMovesTo(state: KeyboardState) {
    mockKeyboardState.value = state
    if (!mockReaction) return
    const open = mockReaction.prepare()
    if (open !== mockReaction.last) mockReaction.react(open, mockReaction.last)
    mockReaction.last = open
    await Promise.resolve()
}

let didShowListeners: (() => void)[] = []
const didShow = () => didShowListeners.forEach(listener => listener())

beforeEach(() => {
    mockKeyboardState.value = KeyboardState.UNKNOWN
    mockReaction = null
    didShowListeners = []
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
        if (event === 'keyboardDidShow') didShowListeners.push(listener as () => void)
        return { remove: () => (didShowListeners = didShowListeners.filter(registered => registered !== listener)) } as ReturnType<typeof Keyboard.addListener>
    })
})

afterEach(() => jest.restoreAllMocks())

const describeOnIos = Platform.OS === 'ios' ? describe : describe.skip
const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnIos('useKeyboardShown on iOS', () => {
    it('calls back on keyboardDidShow, which iOS sends once the keyboard is up', async () => {
        const onShown = jest.fn()
        const { unmount } = await renderHook(() => useKeyboardShown(onShown))
        didShow()
        expect(onShown).toHaveBeenCalledTimes(1)
        await unmount()
        didShow()
        expect(onShown).toHaveBeenCalledTimes(1)
    })
})

describeOnAndroid('useKeyboardShown on Android', () => {
    it('waits for the keyboard to finish opening, not for keyboardDidShow as it starts to rise', async () => {
        const onShown = jest.fn()
        await renderHook(() => useKeyboardShown(onShown))
        await keyboardMovesTo(KeyboardState.OPENING)
        didShow()
        expect(onShown).not.toHaveBeenCalled()

        await keyboardMovesTo(KeyboardState.OPEN)
        expect(onShown).toHaveBeenCalledTimes(1)
    })

    it('calls back once each time the keyboard comes back up', async () => {
        const onShown = jest.fn()
        await renderHook(() => useKeyboardShown(onShown))
        for (const state of [KeyboardState.OPEN, KeyboardState.OPEN, KeyboardState.CLOSING, KeyboardState.CLOSED, KeyboardState.OPENING, KeyboardState.OPEN]) await keyboardMovesTo(state)
        expect(onShown).toHaveBeenCalledTimes(2)
    })
})
