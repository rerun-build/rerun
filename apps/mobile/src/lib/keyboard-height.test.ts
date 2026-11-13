import { renderHook } from '@testing-library/react-native'
import { Dimensions, Keyboard, Platform, type KeyboardEvent, type KeyboardEventName } from 'react-native'
import { KeyboardState } from 'react-native-reanimated'

import { useKeyboardHeight } from '@/lib/keyboard-height'

const WINDOW_HEIGHT = 874
const mockReanimated = { height: { value: 0 }, state: { value: KeyboardState.UNKNOWN } }

jest.mock('react-native-reanimated', () => {
    const { useRef } = jest.requireActual<typeof import('react')>('react')
    return {
        ...jest.requireActual('react-native-reanimated/mock'),
        useAnimatedKeyboard: () => mockReanimated,
        useSharedValue: <T>(initial: T) => useRef({ value: initial }).current,
        useDerivedValue: <T>(compute: () => T) => ({
            get value() {
                return compute()
            },
        }),
    }
})

let listeners: { event: KeyboardEventName; listener: (event: KeyboardEvent) => void }[] = []

// What iOS tells React Native: the keyboard's frame at the end of the move, below the window once hidden.
function keyboardEvent(event: KeyboardEventName, visibleHeight: number) {
    keyboardFrame(event, { screenX: 0, screenY: WINDOW_HEIGHT - visibleHeight, width: 402, height: visibleHeight || 335 })
}

function keyboardFrame(event: KeyboardEventName, frame: KeyboardEvent['endCoordinates']) {
    const payload: KeyboardEvent = { duration: 250, easing: 'keyboard', endCoordinates: frame, startCoordinates: frame, isEventFromThisApp: true }
    listeners.filter(registered => registered.event === event).forEach(({ listener }) => listener(payload))
}

function reanimatedReads(state: KeyboardState, height: number) {
    mockReanimated.state.value = state
    mockReanimated.height.value = height
}

beforeEach(() => {
    reanimatedReads(KeyboardState.UNKNOWN, 0)
    listeners = []
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 402, height: WINDOW_HEIGHT, scale: 3, fontScale: 1 })
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false)
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined)
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
        const entry = { event, listener: listener as (event: KeyboardEvent) => void }
        listeners.push(entry)
        return { remove: () => (listeners = listeners.filter(registered => registered !== entry)) } as ReturnType<typeof Keyboard.addListener>
    })
})

afterEach(() => jest.restoreAllMocks())

const describeOnIos = Platform.OS === 'ios' ? describe : describe.skip
const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnIos('useKeyboardHeight on iOS', () => {
    it('RER-68: keeps the keyboard height once it is up, even when Reanimated reads 0 from a stale keyboard view', async () => {
        const { result } = await renderHook(() => useKeyboardHeight())
        keyboardEvent('keyboardWillShow', 335)
        reanimatedReads(KeyboardState.OPEN, 0)
        expect(result.current.height.value).toBe(335)
    })

    it('RER-72: drops to 0 once the keyboard is gone, even when Reanimated still reads it open', async () => {
        const { result } = await renderHook(() => useKeyboardHeight())
        keyboardEvent('keyboardWillShow', 335)
        reanimatedReads(KeyboardState.OPEN, 335)
        keyboardEvent('keyboardWillHide', 0)
        expect(result.current.height.value).toBe(0)
    })

    it('with a stale view Reanimated never reports the move: the lift goes straight to the announced height', async () => {
        const { result } = await renderHook(() => useKeyboardHeight())
        reanimatedReads(KeyboardState.CLOSED, 0)
        keyboardEvent('keyboardWillShow', 335)
        expect(result.current.height.value).toBe(335)
    })

    it('an empty end frame counts as a hidden keyboard, as with cross-fade transitions or a floating keyboard', async () => {
        const { result } = await renderHook(() => useKeyboardHeight())
        keyboardEvent('keyboardWillShow', 335)
        reanimatedReads(KeyboardState.OPEN, 335)
        keyboardFrame('keyboardWillChangeFrame', { screenX: 0, screenY: 0, width: 0, height: 0 })
        expect(result.current.height.value).toBe(0)
    })

    it('follows Reanimated while the keyboard moves, so the lift stays smooth', async () => {
        const { result } = await renderHook(() => useKeyboardHeight())
        keyboardEvent('keyboardWillShow', 335)
        reanimatedReads(KeyboardState.OPENING, 120)
        expect(result.current.height.value).toBe(120)
        reanimatedReads(KeyboardState.CLOSING, 80)
        expect(result.current.height.value).toBe(80)
    })

    it('starts at the height of a keyboard already up when the screen mounts', async () => {
        jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true)
        jest.spyOn(Keyboard, 'metrics').mockReturnValue({ screenX: 0, screenY: WINDOW_HEIGHT - 335, width: 402, height: 335 })
        const { result } = await renderHook(() => useKeyboardHeight())
        expect(result.current.height.value).toBe(335)
    })

    it('takes a new height while the keyboard stays up, as when switching to emoji', async () => {
        const { result } = await renderHook(() => useKeyboardHeight())
        keyboardEvent('keyboardWillShow', 335)
        reanimatedReads(KeyboardState.OPEN, 335)
        keyboardEvent('keyboardWillChangeFrame', 388)
        expect(result.current.height.value).toBe(388)
    })

    it('keeps Reanimated in an iPad window smaller than the screen, whose bottom is not the keyboard frame\'s', async () => {
        jest.spyOn(Dimensions, 'get').mockImplementation(dimension => ({ width: 1024, height: dimension === 'screen' ? 1366 : 900, scale: 2, fontScale: 1 }))
        const { result } = await renderHook(() => useKeyboardHeight())
        keyboardEvent('keyboardWillShow', 335)
        reanimatedReads(KeyboardState.OPEN, 290)
        expect(result.current.height.value).toBe(290)
    })

    it('stops listening once the screen is gone', async () => {
        const { unmount } = await renderHook(() => useKeyboardHeight())
        await unmount()
        expect(listeners).toHaveLength(0)
    })
})

describeOnAndroid('useKeyboardHeight on Android', () => {
    it('keeps the height Reanimated reads from the window insets', async () => {
        const { result } = await renderHook(() => useKeyboardHeight())
        reanimatedReads(KeyboardState.OPEN, 300)
        expect(result.current.height.value).toBe(300)
    })
})
