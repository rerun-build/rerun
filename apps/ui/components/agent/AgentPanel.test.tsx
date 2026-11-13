// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A screen opened from the coworker's card grows over the thread, its pills, the scrim and the card,
// all kept mounted underneath. Kept painted too, their blurred and faded layers ran a phone's GPU out of
// tiles: on Android Chrome the Apps screen showed holes, a black block and the card through it (RER-93).

type BoardState = {
    agents: { id: string; name: string; disabledAt: string | null }[]
    selectedAgentId: string | null
    selectAgent: (id: string | null) => void
    sessions: never[]
    agentFocusRequest: null
    clearAgentFocus: () => void
    agentFileFocus: { agentId: string; path: string } | null
    agentDataFocus: null
}

const mocks = vi.hoisted(() => ({ board: null as unknown as BoardState }))

vi.mock('@/stores/board.store', () => ({
    useBoardStore: Object.assign((select: (state: BoardState) => unknown) => select(mocks.board), { getState: () => mocks.board }),
}))
vi.mock('@/stores/desktop.store', () => ({ useDesktopStore: (select: (state: { openDesktop: () => void }) => unknown) => select({ openDesktop: vi.fn() }) }))
vi.mock('@/components/layout/SidePanel', () => ({
    SidePanel: ({ children }: { children: React.ReactNode }) => createElement('div', { 'data-side-panel-body': true }, children),
}))
vi.mock('@/components/agent/AgentPanelChat', () => ({ AgentPanelChat: ({ agentId }: { agentId: string }) => createElement('div', { 'data-chat': agentId }) }))
vi.mock('@/components/agent/sheet/AgentCard', () => ({
    AgentCard: ({ onOpen }: { onOpen: (tab: string, from: HTMLElement, shape: string) => void }) =>
        createElement('div', { 'data-card': true }, createElement('button', { type: 'button', onClick: (event: React.MouseEvent<HTMLButtonElement>) => onOpen('services', event.currentTarget, 'tile') }, 'Apps')),
    CardDestinationGhost: () => null,
}))
vi.mock('@/components/agent/sheet/AgentView', () => ({
    AgentView: ({ onBack }: { onBack: () => void }) => createElement('div', { 'data-screen': true }, createElement('button', { type: 'button', onClick: onBack }, 'Back to the card')),
}))
vi.mock('@/components/agent/AgentLockedOverlay', () => ({ AgentLockedOverlay: () => null }))
vi.mock('@/components/desktop/AgentDesktopView', () => ({ AgentDesktopView: () => null }))
vi.mock('@/components/dialogs/DeleteAgentDialog', () => ({ DeleteAgentDialog: () => null }))
vi.mock('@/components/agent/share/ShareAgentDialog', () => ({ ShareAgentDialog: () => null }))
vi.mock('@/components/layout/FeatureFlagsProvider', () => ({ useComputerEnabled: () => false }))
vi.mock('@/hooks/useAgentBuddyMood', () => ({ useAgentBuddyMood: () => 'idle' }))
vi.mock('@/hooks/useConnectorServices', () => ({ useConnectorServices: () => ({ needsConfig: false }) }))
vi.mock('@/hooks/useWorkspaceAccess', () => ({ useWorkspaceAccess: () => ({ access: 'live', needsMachineReason: null }) }))
vi.mock('@rerun/ui', () => ({ BorderBeam: () => null }))
vi.mock('@rerun/ui/iso-grid', () => ({ AgentBuddy: () => null }))

// happy-dom's Web Animations reject on cancel, which motion does on every retarget: without them motion
// runs its own frame loop, which completes like a browser's.
for (const proto of [Element.prototype, HTMLElement.prototype]) Reflect.deleteProperty(proto, 'animate')

const { AgentPanel } = await import('@/components/agent/AgentPanel')

let container: HTMLDivElement
let root: Root

function find(selector: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(selector)
    if (!element) throw new Error(`${selector} is not in the panel`)
    return element
}

function button(label: string): HTMLButtonElement {
    const match = [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent === label)
    if (!match) throw new Error(`no button "${label}"`)
    return match
}

const painted = (element: HTMLElement | null) => !!element && !element.closest('.invisible')
const query = (selector: string) => container.querySelector<HTMLElement>(selector)

async function click(label: string) {
    await act(async () => button(label).click())
}

async function mount() {
    await act(async () => root.render(createElement(AgentPanel)))
}

const underneath = () => ({
    thread: query('[data-chat="a1"]'),
    namePill: query('button[aria-label="Coworker card"]'),
    scrim: query('button[aria-label="Back to the chat"]'),
    card: query('[data-card]'),
})

beforeEach(() => {
    mocks.board = {
        agents: [{ id: 'a1', name: 'Managing Editor', disabledAt: null }],
        selectedAgentId: 'a1',
        selectAgent: vi.fn(),
        sessions: [],
        agentFocusRequest: null,
        clearAgentFocus: vi.fn(),
        agentFileFocus: null,
        agentDataFocus: null,
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
})

describe('AgentPanel, a screen opened from the card', () => {
    it('paints nothing it covers once it has grown: the blurred layers go, the thread and the card stay mounted but hidden', async () => {
        await mount()
        await click('Coworker card')
        await click('Apps')

        await vi.waitFor(() => expect(underneath().scrim).toBeNull(), { timeout: 3000 })
        const layers = underneath()
        expect(layers.namePill).toBeNull()
        expect(layers.thread).not.toBeNull()
        expect(painted(layers.thread)).toBe(false)
        expect(layers.card).not.toBeNull()
        expect(painted(layers.card)).toBe(false)
        expect(painted(find('[data-screen]'))).toBe(true)
    })

    it('leaves the card painted while the screen is still growing out of it', async () => {
        await mount()
        await click('Coworker card')
        await click('Apps')

        const layers = underneath()
        expect(painted(layers.card)).toBe(true)
        expect(painted(layers.thread)).toBe(true)
    })

    it('paints everything again as soon as the way back starts, before the screen folds', async () => {
        await mount()
        await click('Coworker card')
        await click('Apps')
        await vi.waitFor(() => expect(underneath().scrim).toBeNull(), { timeout: 3000 })

        await click('Back to the card')

        const layers = underneath()
        expect(painted(layers.thread)).toBe(true)
        expect(painted(layers.namePill)).toBe(true)
        expect(painted(layers.scrim)).toBe(true)
        expect(painted(layers.card)).toBe(true)
    })

    it('opens a screen reached by a link in place of the thread, with no card or pills behind it', async () => {
        mocks.board.agentFileFocus = { agentId: 'a1', path: 'notes.md' }
        await mount()

        expect(painted(find('[data-screen]'))).toBe(true)
        expect(container.querySelector('[data-card]')).toBeNull()
        expect(container.querySelector('button[aria-label="Coworker card"]')).toBeNull()
        expect(find('[data-chat="a1"]').parentElement?.className).toBe('hidden')
    })
})
