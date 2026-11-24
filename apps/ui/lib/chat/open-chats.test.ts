import { afterClosing, arrive, changeOpenChatsSchema, EMPTY_OPEN_CHATS_MEMO, isRefusedStatus, OpenChatsSync, parseOpenChatsMemo, type ChangeOpenChatsInput, type OpenChats, type OpenChatsMemo } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const COMPUTER = { id: '11111111-1111-4111-8111-111111111111', kind: 'computer' as const }
const PHONE_ID = '22222222-2222-4222-8222-222222222222'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const chat = (id: string) => ({ id, title: `Title ${id[0]}` })
const pickedOnPhone = (activeId: string | null, ids = [A, B]): OpenChats => ({ chats: ids.map(chat), last: { activeId, deviceId: PHONE_ID, deviceKind: 'phone', changedAt: '2026-11-24T09:00:00.000Z' } })
const pickedHere = (activeId: string | null, ids = [A, B]): OpenChats => ({ chats: ids.map(chat), last: { activeId, deviceId: COMPUTER.id, deviceKind: 'computer', changedAt: '2026-11-24T09:00:00.000Z' } })
const here = (activeId: string | null | undefined, dismissedAt: string | null = null) => ({ deviceId: COMPUTER.id, activeId, dismissedAt })

describe('the conversation that takes the place of a closed one', () => {
    it('is the next one, the last one when it was last, General with none left', () => {
        expect(afterClosing([A, B, C], A)).toBe(B)
        expect(afterClosing([A, B, C], C)).toBe(B)
        expect(afterClosing([A], A)).toBeNull()
    })
})

describe('arriving on a coworker', () => {
    it('lands on General and offers the thread picked on another device', () => {
        expect(arrive(pickedOnPhone(B), here(A), 'opening')).toEqual({ openIds: [A, B], activeId: null, resume: { sessionId: B, title: 'Title b', deviceKind: 'phone', changedAt: '2026-11-24T09:00:00.000Z' } })
    })

    it('restores the conversation picked here, offering nothing', () => {
        expect(arrive(pickedHere(B), here(B), 'opening')).toEqual({ openIds: [A, B], activeId: B, resume: null })
    })

    it('offers nothing when General was picked elsewhere', () => {
        expect(arrive(pickedOnPhone(null), here(A), 'opening')).toEqual({ openIds: [A, B], activeId: null, resume: null })
    })

    it('stays on the very thread picked elsewhere', () => {
        expect(arrive(pickedOnPhone(A), here(A), 'opening')).toEqual({ openIds: [A, B], activeId: A, resume: null })
    })

    it('leaves the screen alone when the window comes back, offering the thread', () => {
        const arrival = arrive(pickedOnPhone(B), here(A), 'returning')
        expect(arrival.activeId).toBe(A)
        expect(arrival.resume?.sessionId).toBe(B)
    })

    it('keeps a thread closed elsewhere while it is on screen, and drops it at the next opening', () => {
        expect(arrive(pickedHere(null, [B]), here(A), 'returning')).toEqual({ openIds: [B, A], activeId: A, resume: null })
        expect(arrive(pickedHere(null, [B]), here(A), 'opening')).toEqual({ openIds: [B], activeId: null, resume: null })
    })

    it('keeps the conversation it was opened on', () => {
        expect(arrive(pickedOnPhone(B), here(A), 'opened-on')).toEqual({ openIds: [A, B], activeId: A, resume: null })
    })

    it('does not offer again what was dismissed, nor a thread it cannot open', () => {
        expect(arrive(pickedOnPhone(B), here(null, '2026-11-24T09:00:00.000Z'), 'opening').resume).toBeNull()
        expect(arrive(pickedOnPhone(C), here(null), 'opening').resume).toBeNull()
    })

    it('stays on a draft of its own, unless something was picked elsewhere', () => {
        expect(arrive(pickedHere(B), here(undefined), 'opening').activeId).toBeUndefined()
        expect(arrive(pickedOnPhone(B), here(undefined), 'opening').activeId).toBeNull()
        expect(arrive(pickedOnPhone(B), here(undefined), 'returning').activeId).toBeUndefined()
    })
})

describe('what the hub accepts', () => {
    it('takes a pick of General and refuses an id that is none', () => {
        expect(changeOpenChatsSchema.safeParse({ device: COMPUTER, changes: [{ type: 'select', sessionId: null }] }).success).toBe(true)
        expect(changeOpenChatsSchema.safeParse({ device: COMPUTER, changes: [{ type: 'close', sessionId: 'general' }] }).success).toBe(false)
    })
})

describe('the way between a device and the hub', () => {
    const NOTHING: OpenChats = { chats: [], last: null }
    let memo: OpenChatsMemo
    const read = vi.fn<() => Promise<OpenChats>>()
    const change = vi.fn<(body: ChangeOpenChatsInput) => Promise<OpenChats>>()
    const syncOf = (refused?: (error: unknown) => boolean) => new OpenChatsSync({ device: COMPUTER, memo: { read: () => memo, write: next => void (memo = next) }, read, change, refused })

    beforeEach(() => {
        vi.useFakeTimers()
        memo = { ...EMPTY_OPEN_CHATS_MEMO, merged: true }
        read.mockReset().mockResolvedValue(NOTHING)
        change.mockReset().mockResolvedValue(NOTHING)
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('sends what changed together, a moment later, and forgets it', async () => {
        const sync = syncOf()
        sync.record({ type: 'select', sessionId: A })
        sync.record({ type: 'close', sessionId: B })
        expect(change).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(500)
        expect(change).toHaveBeenCalledExactlyOnceWith({ device: COMPUTER, changes: [{ type: 'select', sessionId: A }, { type: 'close', sessionId: B }] })
        expect(memo.pending).toEqual([])
    })

    it('keeps what the network lost, and sends it before the next read', async () => {
        change.mockRejectedValueOnce(new Error('offline'))
        const sync = syncOf()
        sync.record({ type: 'select', sessionId: A })
        await vi.advanceTimersByTimeAsync(500)
        expect(memo.pending).toHaveLength(1)
        await sync.load({ openIds: [A], activeId: A })
        expect(change).toHaveBeenCalledTimes(2)
        expect(read).not.toHaveBeenCalled()
        expect(memo.pending).toEqual([])
    })

    it('drops what the hub will never take', async () => {
        change.mockRejectedValueOnce(new Error('gone'))
        const sync = syncOf(() => true)
        sync.record({ type: 'select', sessionId: A })
        await vi.advanceTimersByTimeAsync(500)
        expect(memo.pending).toEqual([])
    })

    it('merges its own list once, and gives its conversation to a hub that has none', async () => {
        memo = EMPTY_OPEN_CHATS_MEMO
        const sync = syncOf()
        await sync.load({ openIds: [A, B], activeId: B })
        expect(change.mock.calls.map(([body]) => body)).toEqual([
            { device: COMPUTER, changes: [], merge: [A, B] },
            { device: COMPUTER, changes: [{ type: 'select', sessionId: B }] },
        ])
        await sync.load({ openIds: [A, B], activeId: B })
        expect(read).toHaveBeenCalledOnce()
    })

    it('leaves alone the conversation picked elsewhere when it merges', async () => {
        memo = EMPTY_OPEN_CHATS_MEMO
        change.mockResolvedValue(pickedOnPhone(A))
        await syncOf().load({ openIds: [B], activeId: B })
        expect(change).toHaveBeenCalledOnce()
    })

    it('merges again after a first try the network lost', async () => {
        memo = EMPTY_OPEN_CHATS_MEMO
        change.mockRejectedValueOnce(new Error('offline'))
        const sync = syncOf()
        expect(await sync.load({ openIds: [A], activeId: null })).toBeNull()
        expect(memo.merged).toBe(false)
    })

    it('says so when something changed here while it was reading', async () => {
        const sync = syncOf()
        read.mockImplementation(async () => {
            sync.record({ type: 'select', sessionId: A })
            return NOTHING
        })
        expect(await sync.load({ openIds: [], activeId: null })).toBe('changed')
    })

    it('asks again when something changed here meanwhile, and says so', async () => {
        const sync = syncOf()
        read.mockImplementationOnce(async () => {
            sync.record({ type: 'select', sessionId: A })
            return NOTHING
        })
        change.mockResolvedValue(pickedHere(A))
        const local = vi.fn(() => ({ openIds: [A], activeId: A }))
        expect(await sync.settle(local)).toEqual({ server: pickedHere(A), changedHere: true })
        expect(local).toHaveBeenCalledTimes(2)
        expect(await sync.settle(local)).toEqual({ server: NOTHING, changedHere: false })
    })

    it('gives up on an answer that never stops crossing changes, and on a hub out of reach', async () => {
        const sync = syncOf()
        const crossed = async () => {
            sync.record({ type: 'select', sessionId: A })
            return NOTHING
        }
        read.mockImplementation(crossed)
        change.mockImplementation(crossed)
        expect(await sync.settle(() => ({ openIds: [], activeId: null }))).toBeNull()
        expect(read.mock.calls.length + change.mock.calls.length).toBe(4)

        change.mockReset().mockRejectedValue(new Error('offline'))
        expect(await sync.settle(() => ({ openIds: [], activeId: null }))).toBeNull()
        expect(change).toHaveBeenCalledOnce()
    })

    it('takes a refusal for good, but not a session, a rate or a server that may come back', () => {
        expect([400, 403, 404, 422].every(isRefusedStatus)).toBe(true)
        expect([200, 401, 408, 429, 500, 503].some(isRefusedStatus)).toBe(false)
    })

    it('reads a memo nobody can read as an empty one', () => {
        expect(parseOpenChatsMemo('{"pending":"?"}')).toEqual(EMPTY_OPEN_CHATS_MEMO)
        expect(parseOpenChatsMemo('not json')).toEqual(EMPTY_OPEN_CHATS_MEMO)
        expect(parseOpenChatsMemo(null)).toEqual(EMPTY_OPEN_CHATS_MEMO)
    })
})
