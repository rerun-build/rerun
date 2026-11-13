// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSheetRequest } from '@/hooks/useAgentSheetView'

type BoardState = {
    selectedAgentId: string | null
    agentFocusRequest: { agentId: string; tab: string } | null
    clearAgentFocus: () => void
    agentFileFocus: { agentId: string; path: string } | null
    agentDataFocus: { agentId: string; table: string } | null
}

const mocks = vi.hoisted(() => ({ board: null as unknown as BoardState }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: BoardState) => unknown) => select(mocks.board) }))

const { useAgentSheetView } = await import('@/hooks/useAgentSheetView')

describe('useAgentSheetView', () => {
    let container: HTMLDivElement
    let root: Root
    let shown: string | null = null
    const requests: AgentSheetRequest[] = []

    function Probe() {
        shown = useAgentSheetView(request => requests.push(request)).displayedTab
        return null
    }

    const render = async (board: Partial<BoardState>) => {
        mocks.board = { ...mocks.board, ...board }
        await act(async () => root.render(createElement(Probe)))
    }

    beforeEach(() => {
        requests.length = 0
        mocks.board = { selectedAgentId: 'a', agentFocusRequest: null, clearAgentFocus: vi.fn(() => (mocks.board.agentFocusRequest = null)), agentFileFocus: null, agentDataFocus: null }
        container = document.createElement('div')
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
    })

    it('shows no screen at rest', async () => {
        await render({})
        expect(shown).toBeNull()
        expect(requests).toEqual([])
    })

    it('opens the screen a focus request names, and consumes the request', async () => {
        await render({ agentFocusRequest: { agentId: 'a', tab: 'skills' } })
        expect(shown).toBe('skills')
        expect(requests).toEqual([{ kind: 'screen' }])
        expect(mocks.board.clearAgentFocus).toHaveBeenCalled()
    })

    it('hands what is not a screen to the frame: the list of what waits, or the thread', async () => {
        await render({ agentFocusRequest: { agentId: 'a', tab: 'actions' } })
        await render({ agentFocusRequest: { agentId: 'a', tab: 'chat' } })
        expect(requests).toEqual([{ kind: 'chats', filter: 'needs' }, { kind: 'thread' }])
        expect(shown).toBeNull()
    })

    it('opens Files on the very render a file link lands, and keeps it once the link is read', async () => {
        await render({ agentFileFocus: { agentId: 'a', path: '/x.md' } })
        expect(shown).toBe('files')
        await render({ agentFileFocus: null })
        expect(shown).toBe('files')
        expect(requests).toEqual([{ kind: 'screen' }])
    })

    it('ignores a file link meant for another coworker', async () => {
        await render({ agentFileFocus: { agentId: 'b', path: '/x.md' } })
        expect(shown).toBeNull()
    })

    it('opens another coworker on no screen', async () => {
        await render({ agentDataFocus: { agentId: 'a', table: 'leads' } })
        expect(shown).toBe('data')
        await render({ agentDataFocus: null, selectedAgentId: 'b' })
        expect(shown).toBeNull()
    })
})
