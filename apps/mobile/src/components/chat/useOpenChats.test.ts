import { act, renderHook } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'

import { useOpenChats } from './useOpenChats'

const mockStore = new Map<string, string>()

jest.mock('expo-secure-store', () => ({
    getItem: (key: string) => mockStore.get(key) ?? null,
    setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
}))

describe('the conversations left open on a coworker', () => {
    beforeEach(() => {
        mockStore.clear()
        jest.clearAllMocks()
    })

    // Read before the first frame: the pages never shift under the one opened.
    it('opens on the tabs kept from the last visit at once', async () => {
        mockStore.set('rerun.open-chats.pulse', JSON.stringify(['a', 'b']))
        const { result } = await renderHook(() => useOpenChats('pulse', 'c'))
        expect(result.current[0]).toEqual(['a', 'b', 'c'])
        expect(JSON.parse(mockStore.get('rerun.open-chats.pulse')!)).toEqual(['a', 'b', 'c'])
    })

    it('writes nothing when nothing changed', async () => {
        mockStore.set('rerun.open-chats.pulse', JSON.stringify(['a']))
        await renderHook(() => useOpenChats('pulse', 'a'))
        expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
    })

    it('keeps a conversation opened during the visit', async () => {
        const { result } = await renderHook(() => useOpenChats('pulse', null))
        await act(async () => result.current[1]('d'))
        expect(result.current[0]).toEqual(['d'])
        expect(JSON.parse(mockStore.get('rerun.open-chats.pulse')!)).toEqual(['d'])
    })
})
