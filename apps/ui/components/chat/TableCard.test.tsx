// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    board: { agents: [{ id: 'coworker-1', spaceId: 'box-1' }], openAgentData: vi.fn() },
    openKnowledgeBase: vi.fn(),
}))

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/stores/board.store', () => ({
    useBoardStore: Object.assign((select: (state: typeof mocks.board) => unknown) => select(mocks.board), { getState: () => mocks.board }),
}))
vi.mock('@/stores/workspace-settings.store', () => ({ useWorkspaceSettingsStore: (select: (state: { openKnowledgeBase: typeof mocks.openKnowledgeBase }) => unknown) => select({ openKnowledgeBase: mocks.openKnowledgeBase }) }))
vi.mock('@/lib/foreman-open', () => ({ rememberForemanOpen: vi.fn() }))
vi.mock('@/lib/foreman-layout', () => ({ rememberForemanPlacement: vi.fn() }))
vi.mock('@rerun/ui/chat', () => ({
    TableCard: ({ onOpen, openDisabledReason }: { onOpen?: () => void; openDisabledReason: string }) =>
        createElement('button', { type: 'button', disabled: !onOpen, title: onOpen ? undefined : openDisabledReason, onClick: onOpen }, 'Open'),
}))

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const { TableCard } = await import('./TableCard')
const { useForemanStore } = await import('@/stores/foreman.store')

const CARD = { kind: 'table', scope: 'agent', table: 'leads', view: 'Hot', columns: [], rows: [] } as never

let container: HTMLDivElement
let root: Root

function render(agentId: string) {
    act(() => root.render(createElement(TableCard, { agentId, card: CARD })))
    return container.querySelector('button')!
}

beforeEach(() => {
    vi.clearAllMocks()
    useForemanStore.setState({ agentRowId: 'foreman-row', card: null })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('TableCard', () => {
    it("opens a coworker's table on its sheet", () => {
        const button = render('coworker-1')
        act(() => button.click())
        expect(mocks.board.openAgentData).toHaveBeenCalledWith('coworker-1', 'leads', 'Hot')
    })

    it("opens the Chief of Staff's table on its own card, outside any Box", () => {
        const button = render('foreman-row')
        act(() => button.click())
        expect(useForemanStore.getState().card).toEqual({ screen: 'data', dataFocus: { table: 'leads', view: 'Hot' } })
        expect(mocks.board.openAgentData).not.toHaveBeenCalled()
    })

    it('explains itself for an agent nothing on screen can open', () => {
        const button = render('someone-else')
        expect(button.disabled).toBe(true)
        expect(button.title).toBe('openDisabledReason')
    })
})
