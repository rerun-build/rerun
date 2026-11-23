// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

import { useTranscriptCatchUp } from './useTranscriptCatchUp'

vi.mock('@/supabase/useRealtimeSubscription', () => ({ useRealtimeSubscription: vi.fn() }))

type Message = { id: string; role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] }
type Subscription = { channelId: string; enabled?: boolean; filter?: { column: string; value: string | number }; onUpdate?: () => void; onResync?: () => void }

const say = (id: string, role: Message['role'], text: string): Message => ({ id, role, parts: [{ type: 'text', text }] })
const onScreen = [say('u1', 'user', 'Render the teaser'), say('a1', 'assistant', 'It runs, I will tell you.')]
const woken = [...onScreen, say('u2', 'user', '<job_end computer="pc" job="j" state="succeeded">\nDone\n</job_end>'), say('a2', 'assistant', 'The teaser is ready.')]
const sentElsewhere = [...onScreen, say('u2', 'user', 'Also make a poster'), say('a2', 'assistant', 'Poster done.')]

let root: Root | null = null

function subscription() {
    const calls = vi.mocked(useRealtimeSubscription).mock.calls
    const [table, options] = calls[calls.length - 1] as unknown as [string, Subscription]
    return { table, options }
}

type Row = { table: 'sessions' | 'foreman_conversations'; id: string | null; channelId: string; enabled: boolean }
const sessionRow: Row = { table: 'sessions', id: 'session-1', channelId: 'session-transcript-1', enabled: true }

// The channel's first join is already behind a mounted chat, as it is a moment after a conversation opens.
async function mount(props: { idle: boolean; messages: Message[]; fetchMessages: () => Promise<unknown[]>; row?: Row }, { joined = true } = {}) {
    const setMessages = vi.fn()
    function Probe() {
        useTranscriptCatchUp({ row: sessionRow, ...props, setMessages })
        return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Probe)))
    const fire = (event: 'onUpdate' | 'onResync') => act(async () => subscription().options[event]?.())
    if (joined) await fire('onResync')
    return { rowUpdated: () => fire('onUpdate'), resynced: () => fire('onResync'), setMessages }
}

function deferred() {
    let resolve: (messages: unknown[]) => void = () => {}
    const promise = new Promise<unknown[]>(r => (resolve = r))
    return { promise, resolve }
}

beforeEach(() => {
    vi.mocked(useRealtimeSubscription).mockClear()
})

afterEach(() => {
    act(() => root?.unmount())
    root = null
})

describe('useTranscriptCatchUp', () => {
    it('shows what a run this tab did not start added to the conversation', async () => {
        const { rowUpdated, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages: async () => woken })
        await rowUpdated()
        expect(setMessages).toHaveBeenCalledWith(woken)
    })

    it('shows a turn another device sent while this tab was hidden, once it comes back', async () => {
        const { resynced, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages: async () => sentElsewhere })
        await resynced()
        expect(setMessages).toHaveBeenCalledWith(sentElsewhere)
    })

    it('listens to the row of the conversation on screen, and to nothing without one', async () => {
        await mount({ idle: true, messages: onScreen, fetchMessages: async () => onScreen })
        expect(subscription()).toMatchObject({ table: 'sessions', options: { channelId: 'session-transcript-1', enabled: true, filter: { column: 'id', value: 'session-1' } } })
        act(() => root?.unmount())
        await mount({ idle: true, messages: [], fetchMessages: async () => [], row: { ...sessionRow, id: null } })
        expect(subscription().options.enabled).toBe(false)
        act(() => root?.unmount())
        await mount({ idle: true, messages: [], fetchMessages: async () => [], row: { ...sessionRow, enabled: false } })
        expect(subscription().options.enabled).toBe(false)
    })

    it('reads nothing on the first join of a conversation, which was read as it opened', async () => {
        const fetchMessages = vi.fn(async () => sentElsewhere)
        const { resynced, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages }, { joined: false })
        await resynced()
        expect(fetchMessages).not.toHaveBeenCalled()
        await resynced()
        expect(setMessages).toHaveBeenCalledWith(sentElsewhere)
    })

    it('reads once when the tab comes back while a read is in flight', async () => {
        const pending = deferred()
        const fetchMessages = vi.fn(() => pending.promise)
        const { resynced, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages })
        await resynced()
        await resynced()
        expect(fetchMessages).toHaveBeenCalledTimes(1)
        await act(async () => pending.resolve(sentElsewhere))
        expect(fetchMessages).toHaveBeenCalledTimes(1)
        expect(setMessages).toHaveBeenCalledWith(sentElsewhere)
    })

    it('reads the row again once, when it changed during a read', async () => {
        const first = deferred()
        const fetchMessages = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(woken)
        const { resynced, rowUpdated, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages })
        await resynced()
        await rowUpdated()
        await rowUpdated()
        await act(async () => first.resolve(onScreen))
        expect(fetchMessages).toHaveBeenCalledTimes(2)
        expect(setMessages).toHaveBeenCalledWith(woken)
    })

    it('counts turns, not messages: the screen may split an answer the transcript keeps whole', async () => {
        const split = [say('u1', 'user', 'Render the teaser'), say('a1', 'assistant', 'Starting.'), say('a1b', 'assistant', 'It runs, I will tell you.')]
        const merged = [say('u1', 'user', 'Render the teaser'), say('a1', 'assistant', 'Starting. It runs, I will tell you.'), say('u2', 'user', '<job_end computer="pc" job="j" state="succeeded">\nDone\n</job_end>'), say('a2', 'assistant', 'Ready.')]
        const { rowUpdated, setMessages } = await mount({ idle: true, messages: split.concat(say('a1c', 'assistant', '…')), fetchMessages: async () => merged })
        await rowUpdated()
        expect(setMessages).toHaveBeenCalledWith(merged)
    })

    it('leaves alone a tab that is sending or streaming its own run, even when it comes back', async () => {
        const fetchMessages = vi.fn(async () => woken)
        const { rowUpdated, resynced, setMessages } = await mount({ idle: false, messages: onScreen, fetchMessages })
        await rowUpdated()
        await resynced()
        expect(fetchMessages).not.toHaveBeenCalled()
        expect(setMessages).not.toHaveBeenCalled()
    })

    it('keeps the screen when the transcript holds nothing new, or lacks what is on screen', async () => {
        const same = await mount({ idle: true, messages: onScreen, fetchMessages: async () => onScreen })
        await same.resynced()
        expect(same.setMessages).not.toHaveBeenCalled()
        act(() => root?.unmount())
        const behind = await mount({ idle: true, messages: [...onScreen, say('u3', 'user', 'And the poster?')], fetchMessages: async () => [say('u1', 'user', 'x'), say('a1', 'assistant', 'y'), say('a9', 'assistant', 'z')] })
        await behind.rowUpdated()
        expect(behind.setMessages).not.toHaveBeenCalled()
    })

    it('shrugs off a transcript that cannot be read', async () => {
        const { resynced, setMessages } = await mount({ idle: true, messages: onScreen, fetchMessages: () => Promise.reject(new TypeError('Failed to fetch')) })
        await resynced()
        expect(setMessages).not.toHaveBeenCalled()
    })
})
