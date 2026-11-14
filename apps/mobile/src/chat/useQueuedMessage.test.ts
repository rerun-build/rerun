import { act, renderHook } from '@testing-library/react-native'

import { draftOf, setDraft } from './composer-drafts'
import { useQueuedMessage } from './useQueuedMessage'

const mockFiles = new Map<string, string>()
jest.mock('expo-file-system', () => {
    class Directory {
        name: string
        constructor(_parent: unknown, name: string) {
            this.name = name
        }
        create() {}
    }
    class File {
        path: string
        constructor(parent: { name: string }, name: string) {
            this.path = `${parent.name}/${name}`
        }
        get exists() {
            return mockFiles.has(this.path)
        }
        textSync() {
            return mockFiles.get(this.path) ?? ''
        }
        write(text: string) {
            mockFiles.set(this.path, text)
        }
        delete() {
            mockFiles.delete(this.path)
        }
    }
    return { Directory, File, Paths: { document: null } }
})
jest.mock('expo-crypto', () => ({ randomUUID: () => 'queued-1' }))

describe('useQueuedMessage', () => {
    beforeEach(() => mockFiles.clear())

    it('puts a message that stopped waiting back in an empty composer and deletes it from the queue', async () => {
        const { result } = await renderHook(() => useQueuedMessage('pulse-s1'))
        await act(async () => result.current.enqueue('Send the deck', 'run-1'))
        expect(mockFiles.size).toBe(1)

        await act(async () => result.current.returnToComposer('pulse-s1'))
        expect(draftOf('pulse-s1')).toBe('Send the deck')
        expect(result.current.queued).toBeNull()
        expect(mockFiles.size).toBe(0)
    })

    it('keeps what the person already typed and still deletes the queued message', async () => {
        setDraft('pulse-s2', 'Already typing')
        const { result } = await renderHook(() => useQueuedMessage('pulse-s2'))
        await act(async () => result.current.enqueue('Send the deck', 'run-1'))

        await act(async () => result.current.returnToComposer('pulse-s2'))
        expect(draftOf('pulse-s2')).toBe('Already typing')
        expect(result.current.queued).toBeNull()
        expect(mockFiles.size).toBe(0)
    })
})
