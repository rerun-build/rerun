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

const signOut = vi.hoisted(() => vi.fn())
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ signOut }) }))

const { WelcomeSignOutButton } = await import('./WelcomeSignOutButton')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    signOut.mockReset().mockResolvedValue(undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('WelcomeSignOutButton', () => {
    // RER-388: an account opened by mistake was held on the welcome steps with no way out.
    it('signs out in one click', async () => {
        act(() => root.render(createElement(WelcomeSignOutButton)))
        const button = container.querySelector('button')!
        expect(button.textContent).toBe('Sign out')
        await act(async () => button.click())
        expect(signOut).toHaveBeenCalledOnce()
        expect(button.disabled).toBe(true)
    })
})
