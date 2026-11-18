// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))

const { useBoardStore } = await import('@/stores/board.store')
const { useAgentSchedulesSync } = await import('./useAgentSchedulesSync')

// The workspace arrives a moment after the board mounts. That used to ask for the schedules twice:
// at once, and again a beat later, as if a run had just moved one.

let root: Root | null = null
let container: HTMLElement | null = null
const fetchMock = vi.fn(async () => Response.json([]))

function Probe({ workspaceId }: { workspaceId: number | undefined }) {
    useAgentSchedulesSync(workspaceId)
    return null
}

async function render(workspaceId: number | undefined) {
    await act(async () => root!.render(createElement(Probe, { workspaceId })))
}

describe('useAgentSchedulesSync', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        fetchMock.mockClear()
        vi.stubGlobal('fetch', fetchMock)
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it('asks for the schedules once when the workspace arrives', async () => {
        await render(undefined)
        expect(fetchMock).not.toHaveBeenCalled()

        await render(7)
        await act(async () => vi.advanceTimersByTimeAsync(5_000))

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('asks again a beat after something moved a schedule', async () => {
        await render(7)
        await act(async () => vi.advanceTimersByTimeAsync(5_000))
        fetchMock.mockClear()

        act(() => useBoardStore.getState().requestSchedulesRefresh())
        await act(async () => vi.advanceTimersByTimeAsync(1_000))
        expect(fetchMock).not.toHaveBeenCalled()
        await act(async () => vi.advanceTimersByTimeAsync(1_000))

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
