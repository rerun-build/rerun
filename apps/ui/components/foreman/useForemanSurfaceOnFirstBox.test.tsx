// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpacePublic } from '@/lib/board/types'

vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/app/api/_actions/foreman-intake.actions', () => ({ waiveForemanProfileAction: vi.fn() }))

const { useBoardStore } = await import('@/stores/board.store')
const { useForemanStore } = await import('@/stores/foreman.store')
const { useForemanSurfaceOnFirstBox } = await import('./useForemanSurfaceOnFirstBox')

// A workspace past its onboarding opens with no machine, so no Chief of Staff. Its first coworker
// claims the machine along with its first Box: from there the Chief of Staff is on the engine, and
// it has to show without a reload (RER-260).

const box: SpacePublic = { id: 'box-1', workspace_id: 7, name: 'Marketing', col_start: 0, row_start: 0, col_end: 4, row_end: 4, created_at: '2026-11-22T11:11:01Z' }

let root: Root | null = null
let container: HTMLElement | null = null
const fetchMock = vi.fn(async () => Response.json({ phase: 'companion', surface: 'engine' }))

function Probe() {
    useForemanSurfaceOnFirstBox()
    return null
}

async function mount() {
    await act(async () => root!.render(createElement(Probe)))
}

describe('useForemanSurfaceOnFirstBox', () => {
    beforeEach(() => {
        fetchMock.mockClear()
        vi.stubGlobal('fetch', fetchMock)
        useBoardStore.setState({ spaces: [], hydrated: true })
        useForemanStore.getState().setSurface('none')
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
        vi.unstubAllGlobals()
    })

    it('shows the Chief of Staff once the first Box arrives with the machine', async () => {
        await mount()
        expect(fetchMock).not.toHaveBeenCalled()

        await act(async () => useBoardStore.setState({ spaces: [box] }))

        expect(fetchMock).toHaveBeenCalledWith('/api/chat/foreman/state')
        expect(useForemanStore.getState().surface).toBe('engine')
    })

    it('asks nothing when a workspace whose machine went away loads its Boxes', async () => {
        useBoardStore.setState({ spaces: [], hydrated: false })
        await mount()

        await act(async () => useBoardStore.setState({ spaces: [box], hydrated: true }))

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('asks nothing while the surface is still being read', async () => {
        useForemanStore.setState({ surface: 'unknown' })
        await mount()

        await act(async () => useBoardStore.setState({ spaces: [box] }))

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('asks nothing once the Chief of Staff is on the engine', async () => {
        useForemanStore.getState().setSurface('engine')
        await mount()

        await act(async () => useBoardStore.setState({ spaces: [box] }))

        expect(fetchMock).not.toHaveBeenCalled()
    })
})
