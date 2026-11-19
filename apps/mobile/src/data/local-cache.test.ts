import type { Me } from '@rerun/contracts'
import type { UIMessage } from 'ai'

import { cachedBoard, cachedMe, clearLocalCache, loadCoworkerDetail, loadTranscript, readCoworkerDetails, readCoworkerScreen, readTranscript, sameTranscript, saveCoworkerScreen, saveTranscript } from './local-cache'

// The cache folder as a map of file name to its text, written in order.
const mockDisk = new Map<string, { text: string; writtenAt: number }>()
let mockClock = 0

jest.mock('expo-file-system', () => {
    class File {
        name: string
        constructor(_folder: unknown, name: string) {
            this.name = name
        }
        get exists() {
            return mockDisk.has(this.name)
        }
        get modificationTime() {
            return mockDisk.get(this.name)?.writtenAt
        }
        textSync() {
            return mockDisk.get(this.name)?.text ?? ''
        }
        write(text: string) {
            mockDisk.set(this.name, { text, writtenAt: ++mockClock })
        }
        delete() {
            mockDisk.delete(this.name)
        }
    }
    class Directory {
        exists = true
        create() {}
        delete() {
            mockDisk.clear()
        }
        list() {
            return [...mockDisk.keys()].map(name => new File(this, name))
        }
    }
    return { Directory, File, Paths: {} }
})

const me: Me = { user: { id: 'u1', email: 'a@b.co', name: 'Ada', avatarUrl: null }, workspace: { id: 7, name: 'Acme', iconUrl: null, plan: 'base', subscribed: true, role: 'admin' } }
const flushWrites = () => jest.runOnlyPendingTimers()

const message = (id: string, text = id): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] })

describe('chat cache', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        clearLocalCache()
    })
    afterEach(() => jest.useRealTimers())

    it('hands back the transcript kept for a conversation, and nothing for another workspace', () => {
        saveTranscript(7, 's1', [message('a')])

        expect(readTranscript(7, 's1')?.messages).toEqual([message('a')])
        expect(readTranscript(8, 's1')).toBeNull()
    })

    it('keeps only the end of a long transcript', () => {
        saveTranscript(7, 's1', Array.from({ length: 250 }, (_, index) => message(`m${index}`)))

        const kept = readTranscript(7, 's1')
        expect(kept?.messages).toHaveLength(200)
        expect(kept?.messages[0].id).toBe('m50')
    })

    it('lets the least recently opened conversations go first', () => {
        for (let index = 0; index < 61; index++) saveTranscript(7, `s${index}`, [message('a')])

        expect(readTranscript(7, 's0')).toBeNull()
        expect(readTranscript(7, 's60')).not.toBeNull()
    })

    it('reads a conversation once while a read is on its way, and keeps the answer', async () => {
        const fetchMessages = jest.fn(async () => ({ messages: [message('a')], etag: '"v1"', updatedAt: '2026-11-19T08:00:00Z' }))

        const [first, second] = await Promise.all([loadTranscript(7, 's1', fetchMessages), loadTranscript(7, 's1', fetchMessages)])

        expect(fetchMessages).toHaveBeenCalledTimes(1)
        expect(first).toBe(second)
        expect(readTranscript(7, 's1')).toEqual({ messages: [message('a')], etag: '"v1"', updatedAt: '2026-11-19T08:00:00Z' })
    })

    // The hub reads the conversation again, the body stays there: the copy on the phone is the transcript.
    it('names the transcript it keeps to the hub, and keeps it when the hub says it has not changed', async () => {
        saveTranscript(7, 's1', [message('a')], { etag: '"v1"', updatedAt: '2026-11-19T08:00:00Z' })
        const fetchMessages = jest.fn(async () => ({ messages: null, etag: '"v1"', updatedAt: '2026-11-19T08:05:00Z' }))

        const loaded = await loadTranscript(7, 's1', fetchMessages)

        expect(fetchMessages).toHaveBeenCalledWith('"v1"')
        expect(loaded).toEqual({ messages: [message('a')], unchanged: true, updatedAt: '2026-11-19T08:05:00Z' })
        expect(readTranscript(7, 's1')?.updatedAt).toBe('2026-11-19T08:05:00Z')
    })

    it('names nothing for a transcript cut to its end, nor for one kept by an older app', async () => {
        saveTranscript(7, 's1', Array.from({ length: 250 }, (_, index) => message(`m${index}`)), { etag: '"v1"', updatedAt: null })
        expect(readTranscript(7, 's1')?.etag).toBeNull()

        mockDisk.set('transcript-7-s2.json', { text: JSON.stringify({ v: 1, value: [message('a')] }), writtenAt: 1 })
        expect(readTranscript(7, 's2')).toEqual({ messages: [message('a')], etag: null, updatedAt: null })
    })

    it('drops a read that lands after a sign-out', async () => {
        let answer: (read: { messages: UIMessage[]; etag: null; updatedAt: null }) => void = () => {}
        const loading = loadTranscript(7, 's1', () => new Promise(resolve => (answer = resolve)))

        clearLocalCache()
        answer({ messages: [message('a')], etag: null, updatedAt: null })
        await loading

        expect(readTranscript(7, 's1')).toBeNull()
    })

    it('merges what is read of a coworker screen', () => {
        saveCoworkerScreen(7, 'agent-1', { conversations: [] })
        saveCoworkerScreen(7, 'agent-1', { models: null })

        expect(readCoworkerScreen(7, 'agent-1')).toEqual({ view: null, models: null, conversations: [] })
        expect(readCoworkerScreen(7, 'agent-2').conversations).toBeNull()
    })

    it('reads back from the disk what a previous launch kept', () => {
        mockDisk.set('me-u1.json', { text: JSON.stringify({ v: 1, value: me }), writtenAt: 1 })

        expect(cachedMe('u1').read()).toEqual(me)
        expect(cachedMe('u2').read()).toBeNull()
    })

    it('reads as nothing a file that no longer fits what the hub sends', () => {
        mockDisk.set('me-u1.json', { text: JSON.stringify({ v: 1, value: { user: { id: 'u1' } } }), writtenAt: 1 })
        mockDisk.set('board-7.json', { text: 'not json', writtenAt: 1 })

        expect(cachedMe('u1').read()).toBeNull()
        expect(cachedBoard(7).read()).toBeNull()
    })

    it('never lets a burst of transcripts push the home off the phone', () => {
        cachedBoard(7).save({ agents: [], overview: [], boxes: [] })
        flushWrites()
        for (let index = 0; index < 45; index++) saveTranscript(7, `s${index}`, [message('a')])
        flushWrites()

        expect(mockDisk.has('board-7.json')).toBe(true)
        expect([...mockDisk.keys()].filter(name => name.startsWith('transcript-'))).toHaveLength(40)
        expect(mockDisk.has('transcript-7-s0.json')).toBe(false)
    })

    it('keeps the answer of the hub, but not one that lands after a sign-out', async () => {
        await cachedMe('u1').load(async () => me)
        expect(cachedMe('u1').read()).toEqual(me)

        let answer: (value: Me) => void = () => {}
        const loading = cachedMe('u2').load(() => new Promise(resolve => (answer = resolve)))
        clearLocalCache()
        answer(me)
        await loading
        flushWrites()

        expect(cachedMe('u2').read()).toBeNull()
        expect(mockDisk.size).toBe(0)
    })

    it('hands back an answer the caller declines without keeping it', async () => {
        await cachedMe('u1').load(async () => me)
        const other = { ...me, workspace: { ...me.workspace, id: me.workspace.id + 1 } }

        const answer = await cachedMe('u1').load(async () => other, () => false)
        flushWrites()

        expect(answer).toEqual(other)
        expect(cachedMe('u1').read()).toEqual(me)
    })

    it('does not write again an answer that changed nothing', async () => {
        await cachedMe('u1').load(async () => me)
        flushWrites()
        const writtenAt = mockDisk.get('me-u1.json')?.writtenAt

        await cachedMe('u1').load(async () => ({ ...me }))
        flushWrites()

        expect(mockDisk.get('me-u1.json')?.writtenAt).toBe(writtenAt)
    })

    it('merges the parts of a coworker page as they are read', async () => {
        await loadCoworkerDetail(7, 'agent-1', 'routines', async () => [])
        await loadCoworkerDetail(7, 'agent-1', 'boxes', async () => [])

        expect(readCoworkerDetails(7, 'agent-1')).toMatchObject({ routines: [], boxes: [] })
        expect(readCoworkerDetails(7, 'agent-2')).toEqual({})
    })

    it('tells a transcript that changed from one that did not', () => {
        expect(sameTranscript([message('a')], [message('a')])).toBe(true)
        expect(sameTranscript([message('a')], [message('a', 'edited')])).toBe(false)
        expect(sameTranscript([message('a')], [message('a'), message('b')])).toBe(false)
    })
})
