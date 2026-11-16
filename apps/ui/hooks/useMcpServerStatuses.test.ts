// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Status = 'connected' | 'needs_auth' | 'error' | 'unknown'

let fetchMock: ReturnType<typeof vi.fn>
let latest: { checkedAt?: number | null } = {}

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

async function openPanel(status: Status) {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ servers: [{ name: 'x', status, toolCount: 3 }] }) }))
    const { useMcpServerStatuses } = await import('@/hooks/useMcpServerStatuses')
    function Probe() {
        latest = useMcpServerStatuses('a1') as { checkedAt?: number | null }
        return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(createElement(Probe))
    })
    await settle()
    await act(async () => root.unmount())
}

async function reopen() {
    const { useMcpServerStatuses } = await import('@/hooks/useMcpServerStatuses')
    function Probe() {
        useMcpServerStatuses('a1')
        return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(createElement(Probe))
    })
    await settle()
    await act(async () => root.unmount())
}

beforeEach(() => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
})

describe('useMcpServerStatuses', () => {
    it('tests once per page session while every status is connected', async () => {
        await openPanel('connected')
        await reopen()
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('tests again when the panel opens again after an error', async () => {
        await openPanel('error')
        await reopen()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('tests again when the panel opens again after an unknown', async () => {
        await openPanel('unknown')
        await reopen()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('stamps the time of the test', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.UTC(2026, 10, 12, 21, 30))
        let resolveFetch: (value: unknown) => void = () => {}
        fetchMock.mockImplementation(() => new Promise(resolve => (resolveFetch = resolve)))
        const { useMcpServerStatuses } = await import('@/hooks/useMcpServerStatuses')
        function Probe() {
            latest = useMcpServerStatuses('a1') as { checkedAt?: number | null }
            return null
        }
        const container = document.createElement('div')
        document.body.appendChild(container)
        const root = createRoot(container)
        await act(async () => {
            root.render(createElement(Probe))
        })
        expect(latest.checkedAt).toBeNull()
        await act(async () => resolveFetch({ ok: true, json: async () => ({ servers: [] }) }))
        await settle()
        expect(latest.checkedAt).toBe(1794519000000)
        await act(async () => root.unmount())
    })
})
