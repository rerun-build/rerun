// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionTab } from '@/hooks/useSessionTabs'

// The Chief of Staff's "+" used to swap the thread on screen for the new one: its bar only ever held
// General and the conversation on screen, where a coworker's keeps every thread opened.

type TabsProps = { tabs: SessionTab[]; activeIndex: number; onSelect: (index: number) => void; onClose: (index: number) => void; onCreate: () => void }
const bar = vi.hoisted(() => ({ props: null as TabsProps | null, workspaceId: 1 }))

vi.mock('@/components/agent/sheet/OpenChatsTabs', () => ({
    OpenChatsTabs: (props: TabsProps) => {
        bar.props = props
        return null
    },
}))
vi.mock('@/stores/board.store', () => ({ useBoardStore: { getState: () => ({ selectAgent: vi.fn(), selectSpace: vi.fn() }) } }))
vi.mock('@/lib/foreman-open', () => ({ rememberForemanOpen: vi.fn() }))
vi.mock('@/lib/foreman-layout', () => ({ rememberForemanPlacement: vi.fn() }))
vi.mock('next-intl',() => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: { id: bar.workspaceId } }) }))

const { ForemanTopBar } = await import('./ForemanTopBar')
const { selectForemanInThread, useForemanStore } = await import('@/stores/foreman.store')

const written = new Set<string>()

function Harness() {
    const sessionId = useForemanStore(state => state.sessionId)
    const inThread = useForemanStore(selectForemanInThread)
    const blankDraft = useForemanStore(state => state.draftId === state.sessionId) && !written.has(sessionId)
    const store = useForemanStore.getState()
    return createElement(ForemanTopBar, {
        sessionId,
        inThread,
        blankDraft,
        threads: [],
        onShowGeneral: store.showGeneral,
        onOpenThread: store.openThread,
        onNewTask: () => !blankDraft && store.newChat(),
    })
}

let container: HTMLDivElement
let root: Root

const render = () => act(() => root.render(createElement(Harness)))
const tabs = () => bar.props!.tabs.map(tab => tab.title)
const active = () => bar.props!.tabs[bar.props!.activeIndex]?.id
const press = (action: (props: TabsProps) => void) => act(() => action(bar.props!))
const writeInScreen = () => {
    written.add(useForemanStore.getState().sessionId)
    render()
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    written.clear()
    bar.workspaceId = 1
    useForemanStore.getState().reset()
    useForemanStore.getState().setSurface('engine')
    useForemanStore.getState().setGeneral('general', 'engine')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    render()
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('the Chief of Staff tabs', () => {
    it('keeps the thread on screen when + opens another one', () => {
        press(props => props.onCreate())
        const first = active()
        writeInScreen()
        press(props => props.onCreate())
        expect(tabs()).toEqual(['general', 'untitled', 'untitled'])
        expect(active()).not.toBe(first)
        expect(useForemanStore.getState().sessionId).toBe(active())
    })

    it('lands on the blank "New conversation" when + is pressed again', () => {
        press(props => props.onCreate())
        press(props => props.onCreate())
        expect(tabs()).toEqual(['general', 'untitled'])
    })

    it('adds a thread opened from elsewhere, and shows the tab clicked', () => {
        act(() => useForemanStore.getState().openThread('thread-1'))
        act(() => useForemanStore.getState().openThread('thread-2'))
        expect(bar.props!.tabs.map(tab => tab.id)).toEqual([null, 'thread-1', 'thread-2'])
        press(props => props.onSelect(1))
        expect(useForemanStore.getState().sessionId).toBe('thread-1')
        expect(active()).toBe('thread-1')
        press(props => props.onSelect(0))
        expect(useForemanStore.getState().sessionId).toBe('general')
        expect(bar.props!.activeIndex).toBe(0)
    })

    it('shows the neighbour when the tab on screen is closed, General after the last one', () => {
        act(() => useForemanStore.getState().openThread('thread-1'))
        act(() => useForemanStore.getState().openThread('thread-2'))
        press(props => props.onClose(2))
        expect(useForemanStore.getState().sessionId).toBe('thread-1')
        expect(bar.props!.tabs.map(tab => tab.id)).toEqual([null, 'thread-1'])
        press(props => props.onClose(1))
        expect(useForemanStore.getState().sessionId).toBe('general')
        expect(bar.props!.tabs.map(tab => tab.id)).toEqual([null])
    })

    it('drops a "New conversation" left before anything was written in it', () => {
        act(() => useForemanStore.getState().openThread('thread-1'))
        press(props => props.onCreate())
        press(props => props.onSelect(1))
        expect(bar.props!.tabs.map(tab => tab.id)).toEqual([null, 'thread-1'])
    })

    it('keeps its tabs per workspace', () => {
        act(() => useForemanStore.getState().openThread('thread-1'))
        act(() => root.unmount())
        bar.workspaceId = 2
        useForemanStore.getState().showGeneral()
        root = createRoot(container)
        render()
        expect(bar.props!.tabs.map(tab => tab.id)).toEqual([null])
    })
})
