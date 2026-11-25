// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceSearch } from './useWorkspaceSearch'

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
const seen: { result?: ReturnType<typeof useWorkspaceSearch> } = {}
let root: Root

function Probe({ text }: { text: string }) {
    const result = useWorkspaceSearch(text, true)
    useEffect(() => {
        seen.result = result
    })
    return null
}

const type = (text: string) => act(async () => root.render(createElement(Probe, { text })))
const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    root = createRoot(document.createElement('div'))
})

afterEach(async () => {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('useWorkspaceSearch', () => {
    it('cancels the search the next keystroke replaces', async () => {
        fetchMock.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(Response.json({ hits: [], truncated: true, unavailable: false }))
        await type('boo')
        await wait(250)
        const first = fetchMock.mock.calls[0][1].signal!
        expect(first.aborted).toBe(false)
        await type('boost')
        expect(first.aborted).toBe(true)
        expect(seen.result!.loading).toBe(true)
        await wait(250)
        expect(fetchMock.mock.calls[1][0]).toBe('/api/workspace-search?q=boost')
        expect(seen.result).toEqual({ hits: [], loading: false, truncated: true, unavailable: false })
    })

    it('says the search is unavailable when the route fails, and not once the text moved on', async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 })).mockRejectedValueOnce(new TypeError('Failed to fetch'))
        await type('boo')
        await wait(250)
        expect(seen.result).toMatchObject({ loading: false, unavailable: true })
        await type('boost')
        expect(seen.result).toMatchObject({ loading: true, unavailable: false })
        await wait(250)
        expect(seen.result).toMatchObject({ loading: false, unavailable: true })
    })
})
