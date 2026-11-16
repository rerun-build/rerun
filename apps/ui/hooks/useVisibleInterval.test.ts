// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const attention = vi.hoisted(() => ({ value: 'focused' as 'focused' | 'visible' | 'hidden', listeners: new Set<() => void>() }))

vi.mock('@/lib/desktop-shell/attention', () => ({
    pageAttention: () => attention.value,
    subscribePageAttention: (listener: () => void) => {
        attention.listeners.add(listener)
        return () => attention.listeners.delete(listener)
    },
}))

const { useVisibleInterval } = await import('@/hooks/useVisibleInterval')

function setAttention(value: typeof attention.value) {
    attention.value = value
    for (const listener of attention.listeners) listener()
}

describe('useVisibleInterval', () => {
    let root: Root
    const poll = vi.fn()

    function Probe() {
        useVisibleInterval(poll, 1000)
        return null
    }

    beforeEach(async () => {
        vi.useFakeTimers()
        poll.mockClear()
        attention.value = 'focused'
        root = createRoot(document.createElement('div'))
        await act(async () => root.render(createElement(Probe)))
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        vi.useRealTimers()
    })

    it('polls at once, then on every tick', async () => {
        expect(poll).toHaveBeenCalledTimes(1)
        await act(async () => vi.advanceTimersByTime(3000))
        expect(poll).toHaveBeenCalledTimes(4)
    })

    it('keeps polling behind another app, where the data is still on screen', async () => {
        await act(async () => setAttention('visible'))
        await act(async () => vi.advanceTimersByTime(2000))
        expect(poll).toHaveBeenCalledTimes(3)
    })

    it('stops while hidden and catches up the moment the page is shown again', async () => {
        await act(async () => setAttention('hidden'))
        await act(async () => vi.advanceTimersByTime(5000))
        expect(poll).toHaveBeenCalledTimes(1)

        await act(async () => setAttention('focused'))
        expect(poll).toHaveBeenCalledTimes(2)
    })
})
