// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type BoardState = { selectedAgentId: string | null; agents: { id: string }[]; sessions: { agentId: string; status: string }[] }

const mocks = vi.hoisted(() => ({ board: null as unknown as BoardState }))

vi.mock('@/stores/board.store', () => ({
    useBoardStore: Object.assign((select: (state: BoardState) => unknown) => select(mocks.board), { getState: () => mocks.board }),
}))

const { trimOpenedAgents, useOpenedAgents, KEEP_ALIVE_AGENTS } = await import('@/hooks/useOpenedAgents')

describe('trimOpenedAgents', () => {
    it('keeps the last ones opened, up to the ceiling', () => {
        expect(KEEP_ALIVE_AGENTS).toBe(3)
        expect(trimOpenedAgents(['a', 'b', 'c', 'd'], new Set())).toEqual(['b', 'c', 'd'])
    })

    it('never drops a coworker still answering, however old', () => {
        expect(trimOpenedAgents(['a', 'b', 'c', 'd'], new Set(['a']))).toEqual(['a', 'c', 'd'])
    })

    it('never drops the one just opened, even when every other one is busy', () => {
        expect(trimOpenedAgents(['a', 'b', 'c', 'd'], new Set(['a', 'b', 'c']))).toEqual(['a', 'b', 'c', 'd'])
    })
})

describe('useOpenedAgents', () => {
    let container: HTMLDivElement
    let root: Root
    let opened: string[] = []

    function Probe() {
        opened = useOpenedAgents()
        return null
    }

    const render = async (board: Partial<BoardState>) => {
        mocks.board = { ...mocks.board, ...board }
        await act(async () => root.render(createElement(Probe)))
    }

    beforeEach(() => {
        mocks.board = { selectedAgentId: null, agents: ['a', 'b', 'c', 'd'].map(id => ({ id })), sessions: [] }
        container = document.createElement('div')
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
    })

    it('lists the coworkers in the order they were opened, the selected one last', async () => {
        await render({ selectedAgentId: 'a' })
        await render({ selectedAgentId: 'b' })
        await render({ selectedAgentId: 'a' })
        expect(opened).toEqual(['b', 'a'])
    })

    it('keeps the list when nothing is selected, so a closed panel keeps its streams', async () => {
        await render({ selectedAgentId: 'a' })
        await render({ selectedAgentId: null })
        expect(opened).toEqual(['a'])
    })

    it('drops a coworker deleted since', async () => {
        await render({ selectedAgentId: 'a' })
        await render({ selectedAgentId: 'b' })
        await render({ agents: [{ id: 'b' }] })
        expect(opened).toEqual(['b'])
    })

    it('keeps a coworker whose run is still going past the ceiling', async () => {
        await render({ selectedAgentId: 'a', sessions: [{ agentId: 'a', status: 'working' }] })
        for (const id of ['b', 'c', 'd']) await render({ selectedAgentId: id })
        expect(opened).toEqual(['a', 'c', 'd'])
    })
})
