import { renderHook } from '@testing-library/react-native'
import { BackHandler } from 'react-native'

import { useFocusedSystemBack } from '@/lib/focused-system-back'
import { useSystemBack } from '@/lib/system-back'

// Played as a plain effect: the screen is focused. `mockFocused` false stands for a route pushed over it.
const mockFocused = { current: true }
jest.mock('expo-router', () => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react')
    return {
        useFocusEffect: (effect: () => void | (() => void)) => {
            useEffect(() => (mockFocused.current ? effect() : undefined), [effect])
        },
    }
})

type BackListener = Parameters<typeof BackHandler.addEventListener>[1]

describe('the system back hooks', () => {
    let handlers: BackListener[]

    beforeEach(() => {
        handlers = []
        mockFocused.current = true
        jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
            handlers.push(handler)
            return { remove: () => (handlers = handlers.filter(registered => registered !== handler)) }
        })
    })

    afterEach(() => jest.restoreAllMocks())

    const pressBack = () => handlers.toReversed().some(handler => handler({} as Parameters<BackListener>[0]))

    it.each([
        ['useSystemBack', useSystemBack],
        ['useFocusedSystemBack', useFocusedSystemBack],
    ])('%s runs the latest onBack and consumes the gesture while enabled, nothing otherwise', async (_name, useHook) => {
        const first = jest.fn()
        const second = jest.fn()
        const { rerender, unmount } = await renderHook(({ enabled, onBack }: { enabled: boolean; onBack: () => void }) => useHook(enabled, onBack), { initialProps: { enabled: false, onBack: first } })
        expect(handlers).toHaveLength(0)
        expect(pressBack()).toBe(false)

        await rerender({ enabled: true, onBack: first })
        await rerender({ enabled: true, onBack: second })
        expect(handlers).toHaveLength(1)
        expect(pressBack()).toBe(true)
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)

        await unmount()
        expect(handlers).toHaveLength(0)
    })

    it('useFocusedSystemBack leaves the gesture to a route pushed over the screen', async () => {
        mockFocused.current = false
        await renderHook(() => useFocusedSystemBack(true, jest.fn()))
        expect(handlers).toHaveLength(0)
    })
})
