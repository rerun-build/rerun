// @vitest-environment happy-dom
import { act, createElement, type ReactNode, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionHistoryEntry, SessionHistoryPage } from '@/app/api/_services/conversation.service'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

const listAgentSessionsAction = vi.hoisted(() => vi.fn<(agentId: string, filter?: string, before?: string) => Promise<SessionHistoryPage>>())
vi.mock('@/app/api/_actions/session.actions', () => ({ listAgentSessionsAction, adoptEngineSessionAction: vi.fn() }))
vi.mock('@/hooks/useAttentionSessions', () => ({ useAttentionSessions: () => [] }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: unknown) => unknown) => select({ sessions: [], setSessionStatus: vi.fn(), markSessionsHandled: vi.fn() }) }))
vi.mock('@/components/dialogs/ConfirmDialog', () => ({ ConfirmDialog: ({ children }: { children: ReactNode }) => children }))
vi.mock('@rerun/ui/inbox', () => ({ InboxRow: () => null }))
vi.mock('@rerun/ui/primitives', async importOriginal => ({
    ...(await importOriginal<object>()),
    ScrollFade: ({ children, scrollRef }: { children: ReactNode; scrollRef?: RefObject<HTMLDivElement | null> }) => createElement('div', { ref: scrollRef }, children),
}))

type Observed = { callback: IntersectionObserverCallback; disconnected: boolean }
let observers: Observed[] = []
class FakeIntersectionObserver {
    private observed: Observed
    constructor(callback: IntersectionObserverCallback) {
        this.observed = { callback, disconnected: false }
        observers.push(this.observed)
    }
    observe() {}
    disconnect() {
        this.observed.disconnected = true
    }
}

const { AgentChatsList } = await import('./AgentChatsList')

const minutesAgo = (minutes: number) => new Date(Date.parse('2026-11-23T12:00:00Z') - minutes * 60_000).toISOString()

const entry = (id: string, updatedAt: string): SessionHistoryEntry => ({
    id,
    agentId: 'a',
    engineSessionId: `engine-${id}`,
    title: `${id} title`,
    status: 'idle',
    updatedAt,
    source: 'dashboard',
    originAgentId: null,
    originAgentName: null,
    automationName: null,
    outcome: null,
    kind: 'thread',
    createdAt: updatedAt,
    firstMessage: null,
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    observers = []
    listAgentSessionsAction.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
})

async function render() {
    await act(async () => {
        root.render(createElement(AgentChatsList, { agentId: 'a', agentName: 'Closer', activeSessionId: null, initialFilter: 'all', onSelect: vi.fn(), onRename: vi.fn(), onCreateNew: vi.fn(), onClose: vi.fn() }))
    })
}

async function scrollToTheEnd() {
    await act(async () => {
        observers.filter(observed => !observed.disconnected).at(-1)?.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
}

const titles = () => [...container.querySelectorAll('button span.truncate')].map(node => node.textContent)

const chip = (label: string) => [...container.querySelectorAll('button')].find(button => button.textContent?.startsWith(label))!

describe('AgentChatsList', () => {
    it('loads the older threads from the cursor as the end of the list comes into view, once each', async () => {
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('t1', minutesAgo(1)), entry('t2', minutesAgo(2))], before: minutesAgo(2) })
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('t2', minutesAgo(2)), entry('t3', minutesAgo(3))], before: null })
        await render()

        await scrollToTheEnd()

        expect(listAgentSessionsAction).toHaveBeenLastCalledWith('a', 'all', minutesAgo(2))
        expect(titles()).toEqual(['t1 title', 't2 title', 't3 title'])

        await scrollToTheEnd()
        expect(listAgentSessionsAction).toHaveBeenCalledTimes(2)
    })

    it('stops when a page brings nothing new', async () => {
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('t1', minutesAgo(1))], before: minutesAgo(1) })
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('t1', minutesAgo(1))], before: minutesAgo(1) })
        await render()

        await scrollToTheEnd()
        await scrollToTheEnd()

        expect(listAgentSessionsAction).toHaveBeenCalledTimes(2)
    })

    it('drops an older page that arrives after the chip changed', async () => {
        let resolveOlder: (page: SessionHistoryPage) => void = () => {}
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('t1', minutesAgo(1))], before: minutesAgo(1) })
        listAgentSessionsAction.mockReturnValueOnce(new Promise(resolve => (resolveOlder = resolve)))
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('chat', minutesAgo(5))], before: null })
        await render()
        await scrollToTheEnd()

        await act(async () => chip('Chats').click())
        await act(async () => resolveOlder({ entries: [entry('stale', minutesAgo(9))], before: null }))

        expect(listAgentSessionsAction).toHaveBeenLastCalledWith('a', 'chats')
        expect(titles()).toEqual(['chat title'])
    })

    it('offers to try again when an older page fails', async () => {
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('t1', minutesAgo(1))], before: minutesAgo(1) })
        listAgentSessionsAction.mockRejectedValueOnce(new Error('down'))
        listAgentSessionsAction.mockResolvedValueOnce({ entries: [entry('t2', minutesAgo(2))], before: null })
        await render()

        await scrollToTheEnd()
        const retry = [...container.querySelectorAll('button')].find(button => button.textContent === "Couldn't load older threads. Try again")
        expect(retry).toBeDefined()

        await act(async () => retry!.click())
        await scrollToTheEnd()

        expect(titles()).toEqual(['t1 title', 't2 title'])
    })
})
