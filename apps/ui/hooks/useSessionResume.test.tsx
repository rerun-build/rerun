// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@/app/api/_services/conversation.service'
import { openSessionAction } from '@/app/api/_actions/session.actions'
import { useSessionResume } from './useSessionResume'

vi.mock('@/app/api/_actions/session.actions', () => ({ openSessionAction: vi.fn() }))

type Options = Parameters<typeof useSessionResume>[0]
const snapshot: SessionSnapshot = {
    messages: [{ id: 'missed', role: 'user', parts: [{ type: 'text', text: 'Sent from desktop' }] }],
    usage: null, lastError: null, activeRunId: null, proposals: [],
}

function Harness(props: Options) {
    useSessionResume(props)
    return null
}

let root: Root
let container: HTMLElement
let options: Options
let visible: boolean

async function render(changes: Partial<Options> = {}) {
    options = { ...options, ...changes }
    await act(async () => root.render(createElement(Harness, options)))
}

async function visibility(show: boolean) {
    visible = show
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
}

function deferredSnapshot() {
    let resolve!: (value: SessionSnapshot) => void
    vi.mocked(openSessionAction).mockReturnValueOnce(new Promise(done => { resolve = done }))
    return async () => act(async () => resolve(snapshot))
}

beforeEach(() => {
    vi.resetAllMocks()
    visible = true
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    options = { sessionId: 'session-1', enabled: true, messages: [], sendingRef: { current: false }, onSnapshot: vi.fn() }
    vi.mocked(openSessionAction).mockResolvedValue(snapshot)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
})

describe('refreshing a conversation after browser suspension', () => {
    it('loads missed messages on return without duplicating the initial history request', async () => {
        await render()
        expect(openSessionAction).not.toHaveBeenCalled()
        await visibility(false)
        expect(openSessionAction).not.toHaveBeenCalled()
        await visibility(true)
        expect(openSessionAction).toHaveBeenCalledExactlyOnceWith('session-1')
        expect(options.onSnapshot).toHaveBeenCalledWith(snapshot)
    })

    it('refreshes on a cached page restore and coalesces simultaneous network recovery', async () => {
        const finish = deferredSnapshot()
        await render()
        await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })))
        expect(openSessionAction).not.toHaveBeenCalled()
        await act(async () => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
            window.dispatchEvent(new Event('online'))
        })
        expect(openSessionAction).toHaveBeenCalledTimes(1)
        await finish()
        expect(options.onSnapshot).toHaveBeenCalledWith(snapshot)
    })

    it('does not refresh an inactive, loading, streaming, or reconnecting chat', async () => {
        await render({ enabled: false })
        await visibility(true)
        await act(async () => window.dispatchEvent(new Event('online')))
        expect(openSessionAction).not.toHaveBeenCalled()
    })

    it('does not fetch before a session exists or when a send has just started', async () => {
        await render({ sessionId: null })
        await visibility(true)
        await render({ sessionId: 'session-1' })
        options.sendingRef.current = true
        await visibility(true)
        expect(openSessionAction).not.toHaveBeenCalled()
    })

    it.each(['messages', 'session', 'stream', 'send', 'hidden', 'unmount'] as const)(
        'discards a pending snapshot after %s changes', async change => {
            const finish = deferredSnapshot()
            await render()
            await visibility(true)
            if (change === 'messages') await render({ messages: [{ id: 'new', role: 'user', parts: [{ type: 'text', text: 'Newer message' }] }] })
            if (change === 'session') await render({ sessionId: 'session-2' })
            if (change === 'stream') await render({ enabled: false })
            if (change === 'send') options.sendingRef.current = true
            if (change === 'hidden') await visibility(false)
            if (change === 'unmount') await act(async () => root.render(null))
            await finish()
            expect(options.onSnapshot).not.toHaveBeenCalled()
        }
    )

    it('keeps existing history on failure and retries when connectivity returns', async () => {
        vi.mocked(openSessionAction).mockRejectedValueOnce(new Error('offline'))
        await render()
        await visibility(true)
        expect(options.onSnapshot).not.toHaveBeenCalled()
        await act(async () => window.dispatchEvent(new Event('online')))
        expect(openSessionAction).toHaveBeenCalledTimes(2)
        expect(options.onSnapshot).toHaveBeenCalledWith(snapshot)
    })

    it('removes resume listeners on unmount', async () => {
        await render()
        await act(async () => root.render(null))
        await visibility(true)
        await act(async () => {
            window.dispatchEvent(new Event('online'))
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
        })
        expect(openSessionAction).not.toHaveBeenCalled()
    })
})
