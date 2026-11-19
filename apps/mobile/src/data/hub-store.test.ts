import { act, renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import { forgetHub, useHub } from './hub-store'

let appStateListeners: ((state: AppStateStatus) => void)[] = []

const deferred = <T,>() => {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>(done => (resolve = done))
    return { promise, resolve }
}

describe('the hub store', () => {
    beforeEach(() => {
        forgetHub()
        appStateListeners = []
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
            appStateListeners.push(listener as (state: AppStateStatus) => void)
            return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
        })
    })

    // Three pages of the same coworker ask for its skills: one request.
    it('asks once for a value several screens read at the same time', async () => {
        const answer = deferred<string[]>()
        const fetch = jest.fn(() => answer.promise)
        const first = await renderHook(() => useHub('skills:7:pulse', fetch))
        const second = await renderHook(() => useHub('skills:7:pulse', fetch))
        await act(async () => answer.resolve(['weekly-report']))
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(first.result.current.value).toEqual(['weekly-report'])
        expect(second.result.current.value).toBe(first.result.current.value)
    })

    it('asks nothing for a value read moments ago', async () => {
        const fetch = jest.fn(async () => ['weekly-report'])
        const opened = await renderHook(() => useHub('skills:7:pulse', fetch))
        await act(async () => {})
        await opened.unmount()
        await renderHook(() => useHub('skills:7:pulse', fetch))
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('keeps the object it holds when the hub says the same again, so nothing is drawn again', async () => {
        const fetch = jest.fn(async () => ({ name: 'Pulse' }))
        const { result } = await renderHook(() => useHub('view:7:pulse', fetch))
        await act(async () => {})
        const held = result.current.value
        await act(async () => void (await result.current.reload()))
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(result.current.value).toBe(held)
    })

    it('opens on the copy kept on the phone, and keeps it when the hub cannot be reached', async () => {
        const save = jest.fn()
        const { result } = await renderHook(() => useHub('board:7', () => Promise.reject(new Error('offline')), { persisted: { read: () => ({ rows: 2 }), save } }))
        expect(result.current).toMatchObject({ value: { rows: 2 }, fresh: false })
        await act(async () => {})
        expect(result.current).toMatchObject({ value: { rows: 2 }, fresh: false, failed: true })
        expect(save).not.toHaveBeenCalled()
    })

    it('reads again what the screens on show hold when the app comes back, once each', async () => {
        const fetch = jest.fn(async () => ['weekly-report'])
        await renderHook(() => useHub('skills:7:pulse', fetch))
        await renderHook(() => useHub('skills:7:pulse', fetch))
        await act(async () => {})
        await act(async () => appStateListeners.forEach(listener => listener('active')))
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('forgets what it held once the person signs out', async () => {
        const fetch = jest.fn(async () => ['weekly-report'])
        await renderHook(() => useHub('skills:7:pulse', fetch))
        await act(async () => {})
        forgetHub()
        const { result } = await renderHook(() => useHub('skills:7:pulse', jest.fn(() => new Promise<string[]>(() => {}))))
        expect(result.current.value).toBeNull()
    })
})
