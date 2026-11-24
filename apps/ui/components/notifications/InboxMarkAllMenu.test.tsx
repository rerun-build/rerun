// @vitest-environment happy-dom
import { InboxSurface } from '@rerun/ui/inbox'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

const stores = vi.hoisted(() => ({ markSessionsHandled: vi.fn(), markSeen: vi.fn() }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: { getState: () => ({ markSessionsHandled: stores.markSessionsHandled }) } }))
vi.mock('@/stores/unseen-runs.store', () => ({ useUnseenRunsStore: { getState: () => ({ markSeen: stores.markSeen }) } }))
vi.mock('@/hooks/useInboxItems', () => ({ inboxCount: (items: { count?: number }[]) => items.reduce((sum, item) => sum + (item.count ?? 1), 0) }))

import type { InboxItem } from '@/hooks/useInboxItems'

const { InboxClearAllDialog, InboxMarkAllMenu } = await import('./InboxMarkAllMenu')

const item = (id: string, patch: Partial<InboxItem>): InboxItem => ({ id, agentId: 'a1', agentName: 'Scout', engineSessionId: null, status: 'awaiting_approval', title: id, message: null, updatedAt: null, ...patch })
const approval = item('approval', {})
const question = item('question', { status: 'awaiting_question' })
const headsUp = item('heads-up', { status: 'awaiting_ack' })
const error = item('error', { status: 'error' })
const done = item('done', { status: 'done', count: 3, sessionIds: ['run-1', 'run-2'] })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.resetAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const onClearAll = vi.fn()
const onOpenChange = vi.fn()
const render = (items: InboxItem[]) => act(() => root.render(createElement(InboxMarkAllMenu, { items, onOpenChange, onClearAll })))
const open = () =>
    act(() => {
        container.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    })
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
const labels = () => menuItems().map(entry => entry.textContent)
const choose = (label: string) =>
    act(() => {
        menuItems()
            .find(entry => entry.textContent === label)!
            .click()
    })

describe('InboxMarkAllMenu', () => {
    it('counts the runs of what only informs, as the chips do, and the requests apart', () => {
        render([approval, question, headsUp, error, done])
        open()
        expect(labels()).toEqual(['Mark 5 notifications as read', 'Clear all, including 2 requests'])
    })

    it('marks what only informs and leaves the requests, even one that stopped on an approval since', () => {
        render([approval, headsUp, error, done])
        open()
        choose('Mark 5 notifications as read')
        const [sessionIds, statuses] = stores.markSessionsHandled.mock.calls[0]
        expect(sessionIds).toEqual(['heads-up', 'error'])
        expect([...statuses].sort()).toEqual(['awaiting_ack', 'error'])
        expect(stores.markSeen).toHaveBeenCalledWith(['run-1', 'run-2'])
        expect(onClearAll).not.toHaveBeenCalled()
    })

    it('marks what it counted, not what arrived while it was open', () => {
        render([approval, error])
        open()
        render([approval, error, headsUp])
        choose('Mark 1 notification as read')
        expect(stores.markSessionsHandled.mock.calls[0][0]).toEqual(['error'])
    })

    it('has nothing to mark when only requests are left', () => {
        render([approval])
        open()
        expect(labels()).toEqual(['No notification to mark', 'Clear all, including 1 request'])
        expect(menuItems()[0].hasAttribute('data-disabled')).toBe(true)
    })

    it('offers no clear all without a request', () => {
        render([done])
        open()
        expect(labels()).toEqual(['Mark 3 notifications as read'])
    })

    it('hands the whole list to the confirmation', () => {
        render([approval, done])
        open()
        choose('Clear all, including 1 request')
        expect(onClearAll).toHaveBeenCalledWith([approval, done])
        expect(stores.markSessionsHandled).not.toHaveBeenCalled()
    })
})

describe('InboxMarkAllMenu in the inbox card', () => {
    const renderCard = (items: InboxItem[]) =>
        root.render(
            createElement(InboxSurface<InboxItem>, { items, open: true, onOpenChange: () => {}, onOpenItem: () => {}, onMarkRead: () => {}, showSettings: false, markAllControl: createElement(InboxMarkAllMenu, { items, onOpenChange, onClearAll }) })
        )
    const openIn = (items: InboxItem[]) => {
        act(() => renderCard(items))
        stores.markSessionsHandled.mockImplementation((ids: string[]) => renderCard(items.filter(entry => !ids.includes(entry.id))))
        onOpenChange.mockClear()
        act(() => {
            document.querySelector('[aria-label="Mark notifications as read"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
        })
        expect(onOpenChange).toHaveBeenLastCalledWith(true)
    }

    it('reports its closing while a request stays in the list', () => {
        openIn([approval, error])
        choose('Mark 1 notification as read')
        expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })

    it('reports its closing when marking empties the list and takes the menu away', () => {
        openIn([error])
        choose('Mark 1 notification as read')
        expect(document.querySelector('[aria-label="Mark notifications as read"]')).toBeNull()
        expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })

    it('reports its closing when the list empties under the open menu', () => {
        openIn([error])
        act(() => renderCard([]))
        expect(menuItems()).toEqual([])
        expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })
})

describe('InboxClearAllDialog', () => {
    it('says what leaves unanswered, and clears it once confirmed', () => {
        act(() => root.render(createElement(InboxClearAllDialog, { items: [approval, question, error, done], onClose: () => {} })))
        const dialog = document.querySelector('[role="alertdialog"]')!
        expect(dialog.textContent).toContain('2 waiting requests leave the inbox without an answer')
        act(() => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Clear all')!.click())
        expect(stores.markSessionsHandled.mock.calls[0][0]).toEqual(['approval', 'question', 'error'])
        expect(stores.markSeen).toHaveBeenCalledWith(['run-1', 'run-2'])
    })
})
