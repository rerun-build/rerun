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
vi.mock('@/stores/board.store', () => ({
    useBoardStore: { getState: () => ({ agents: [], spaces: [], agentOnlineMap: {}, agentEngineBusyMap: {}, setAgentOnline: () => {}, setAgentEngineBusy: () => {}, setLiveLinks: () => {}, dropSpaces: () => false }) },
}))

const { useAgentHealthSync } = await import('@/hooks/useAgentHealthSync')

const SECOND = 1000
const MINUTE = 60 * SECOND

describe('useAgentHealthSync', () => {
    let root: Root
    const fetchMock = vi.fn(async () => Response.json({ statuses: {}, links: [] }))

    function Probe() {
        useAgentHealthSync(1)
        return null
    }

    const polls = () => fetchMock.mock.calls.length
    const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    const gesture = () => act(async () => window.dispatchEvent(new Event('pointerdown')))
    const setAttention = (value: typeof attention.value) =>
        act(async () => {
            attention.value = value
            for (const listener of attention.listeners) listener()
        })

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

    it('reads every ten seconds while someone uses the page', async () => {
        expect(polls()).toBe(1)
        for (let i = 0; i < 6; i++) {
            await wait(30 * SECOND)
            await gesture()
        }
        expect(polls()).toBe(1 + 18)
    })

    it('slows down to once a minute after five minutes without a gesture', async () => {
        await wait(5 * MINUTE)
        const atIdle = polls()
        expect(atIdle).toBe(30)
        await wait(10 * MINUTE)
        expect(polls() - atIdle).toBe(10)
    })

    it('reads at once on the first gesture, then every ten seconds again', async () => {
        await wait(7 * MINUTE + 30 * SECOND)
        const before = polls()
        await gesture()
        expect(polls()).toBe(before + 1)
        await wait(30 * SECOND)
        expect(polls()).toBe(before + 4)
    })

    it('a gesture while active reads nothing more than the ten-second beat', async () => {
        await wait(5 * SECOND)
        await gesture()
        expect(polls()).toBe(1)
    })

    it('stops on a hidden page and reads as soon as it is shown again', async () => {
        await setAttention('hidden')
        const hidden = polls()
        await wait(20 * MINUTE)
        expect(polls()).toBe(hidden)
        await setAttention('focused')
        expect(polls()).toBe(hidden + 1)
    })

    it('over twelve minutes, an idle tab reads 37 times instead of 73', async () => {
        await wait(12 * MINUTE)
        expect(polls()).toBe(37)
    })
})
