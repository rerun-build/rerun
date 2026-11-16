// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const attention = vi.hoisted(() => ({ value: 'focused' as 'focused' | 'visible' | 'hidden', listeners: new Set<(shown: boolean) => void>() }))

vi.mock('@/lib/desktop-shell/attention', () => ({
    pageAttention: () => attention.value,
    onPageShownOrHidden: (listener: (shown: boolean) => void) => {
        attention.listeners.add(listener)
        return () => attention.listeners.delete(listener)
    },
}))

const { usePresenceHeartbeat } = await import('@/hooks/usePresenceHeartbeat')

describe('usePresenceHeartbeat', () => {
    let root: Root
    const fetchMock = vi.fn(async () => new Response(null))

    function Probe() {
        usePresenceHeartbeat(true)
        return null
    }

    const methods = () => fetchMock.mock.calls.map(call => (call as unknown as [string, RequestInit])[1].method)

    beforeEach(async () => {
        vi.useFakeTimers()
        fetchMock.mockClear()
        vi.stubGlobal('fetch', fetchMock)
        attention.value = 'focused'
        root = createRoot(document.createElement('div'))
        await act(async () => root.render(createElement(Probe)))
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it('says the person left when the desktop window is hidden, and stops beating', async () => {
        expect(methods()).toEqual(['POST'])

        attention.value = 'hidden'
        for (const listener of attention.listeners) listener(false)
        await act(async () => vi.advanceTimersByTime(60_000))

        expect(methods()).toEqual(['POST', 'DELETE'])
    })

    it('is back as soon as the window is shown again', async () => {
        attention.value = 'hidden'
        for (const listener of attention.listeners) listener(false)
        attention.value = 'focused'
        for (const listener of attention.listeners) listener(true)

        expect(methods()).toEqual(['POST', 'DELETE', 'POST'])
    })
})
