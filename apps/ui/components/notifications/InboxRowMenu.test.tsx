// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

const prefs = vi.hoisted(() => ({ reads: 0, rule: { follow: true, mode: 'all' } }))
vi.mock('@/hooks/useNotificationPrefs', () => ({
    useNotificationPrefs: () => {
        prefs.reads++
        return { ruleOf: () => prefs.rule, setCoworkerRule: () => {} }
    },
}))

vi.mock('@/stores/notifications.store', () => ({ useNotificationsStore: { getState: () => ({ openNotifications: () => {} }) } }))

const { InboxRowMenu } = await import('./InboxRowMenu')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    prefs.reads = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)

describe('InboxRowMenu', () => {
    it('reads the notification preferences only once it is opened', () => {
        act(() => root.render(createElement(InboxRowMenu, { agentId: 'agent-1', agentName: 'Closer', onOpenChange: () => {} })))
        expect(prefs.reads).toBe(0)
        expect(menuItems()).toEqual([])

        const trigger = container.querySelector('button')!
        act(() => {
            trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
        })
        expect(prefs.reads).toBeGreaterThan(0)
        expect(menuItems()).toHaveLength(3)
        expect(menuItems()[1]).toContain('Closer')
    })
})
