// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IsoAgent } from '@/lib/board/types'

const board = vi.hoisted(() => ({ agents: [] as Partial<IsoAgent>[] }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: typeof board) => unknown) => select(board) }))

const { AgentBuddy } = await import('@rerun/ui/iso-grid')
const { CoworkerLooks } = await import('./CoworkerLooks')

let container: HTMLDivElement
let root: Root

async function renderBuddies(...buddies: Parameters<typeof AgentBuddy>[0][]) {
    await act(async () => root.render(createElement(CoworkerLooks, null, ...buddies.map((props, index) => createElement('div', { key: index }, createElement(AgentBuddy, props))))))
    return [...container.querySelectorAll(':scope > div')].map(cell => cell.innerHTML)
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
})

describe('CoworkerLooks', () => {
    it('dresses the buddy of a coworker that was given a look, wherever it is drawn and at every size', async () => {
        board.agents = [{ id: 'dressed', look: { eyes: 'heart', mouth: 'cat', color: '#00b862' } }, { id: 'plain', look: null }]
        const [large, small, plain] = await renderBuddies({ agentId: 'dressed', size: 64 }, { agentId: 'dressed', size: 20 }, { agentId: 'plain', size: 64 })

        expect(large).toContain('#00b862')
        expect(small).toContain('#00b862')
        expect(plain).not.toContain('#00b862')
    })

    it('draws the look a picker previews over the one the coworker wears', async () => {
        board.agents = [{ id: 'dressed', look: { eyes: 'heart', mouth: 'cat', color: '#00b862' } }]
        const [preview] = await renderBuddies({ agentId: 'dressed', size: 64, look: { eyes: 'round', mouth: 'none', color: '#f0127f' } })

        expect(preview).toContain('#f0127f')
        expect(preview).not.toContain('#00b862')
    })
})
