// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThreadRow } from '@/app/api/_services/conversation.service'

// A server action whose request never reaches the server (a laptop waking up before its network,
// one going back to sleep mid-request) rejects with the browser's own TypeError. The threads are
// read again on every realtime event and every resync of the channel, with nobody waiting on the
// answer: such a rejection used to surface as an unhandled "Failed to fetch" (RER-94).

const mocks = vi.hoisted(() => ({ listAgentThreadsAction: vi.fn() }))
vi.mock('@/app/api/_actions/session.actions', () => ({ listAgentThreadsAction: mocks.listAgentThreadsAction }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: { sessions: [] }) => unknown) => select({ sessions: [] }) }))

const REFRESH_DEBOUNCE_MS = 500

const thread: ThreadRow = {
    id: 'session-1',
    title: 'Weekly report',
    status: 'idle',
    source: 'dashboard',
    createdAt: '2026-11-12T09:00:00.000Z',
    updatedAt: '2026-11-12T09:05:00.000Z',
    originAgentId: null,
    automationName: null,
    outcome: null,
    firstMessage: 'Write the weekly report',
}

let root: Root | null = null
let seen: { threads: ThreadRow[]; refresh: () => void } = { threads: [], refresh: () => {} }
let unhandled: unknown[] = []
const collectUnhandled = (reason: unknown) => unhandled.push(reason)

async function mount() {
    const { useAgentThreads } = await import('./useAgentThreads')
    function Probe() {
        seen = useAgentThreads('agent-1')
        return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Probe)))
}

async function settleRejections() {
    vi.useRealTimers()
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
    })
}

describe('useAgentThreads on a network failure', () => {
    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        mocks.listAgentThreadsAction.mockReset()
        unhandled = []
        process.on('unhandledRejection', collectUnhandled)
    })
    afterEach(() => {
        process.off('unhandledRejection', collectUnhandled)
        act(() => root?.unmount())
        root = null
        vi.useRealTimers()
    })

    it('keeps the threads it shows when a refresh never reaches the server', async () => {
        vi.useFakeTimers()
        mocks.listAgentThreadsAction.mockResolvedValueOnce([thread]).mockRejectedValueOnce(new TypeError('Failed to fetch'))
        await mount()
        expect(seen.threads.map(row => row.id)).toEqual(['session-1'])

        await act(async () => {
            seen.refresh()
            await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
        })
        await settleRejections()

        expect(mocks.listAgentThreadsAction).toHaveBeenCalledTimes(2)
        expect(unhandled).toEqual([])
        expect(seen.threads.map(row => row.id)).toEqual(['session-1'])
    })

    it('leaves nothing behind when the first read never reaches the server', async () => {
        mocks.listAgentThreadsAction.mockRejectedValueOnce(new TypeError('Failed to fetch'))
        await mount()
        await settleRejections()

        expect(mocks.listAgentThreadsAction).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
        expect(seen.threads).toEqual([])
    })
})
