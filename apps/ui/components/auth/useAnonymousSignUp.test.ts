// @vitest-environment happy-dom
import { act, createElement, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The account dialog mounts closed and only draws the form once opened. Turnstile draws its widget
// into a container once, when the hook that owns it mounts: the widget must therefore be owned by
// something rendered inside the form, never by the dialog itself.

vi.mock('@/app/(authflow)/auth/actions', () => ({
    completeSignupAction: vi.fn(),
    prepareAnonymousEmailStep: vi.fn(),
    resendLiveSignInCode: vi.fn(),
}))
vi.mock('@/components/auth/AuthMethods', () => ({
    AuthMethods: ({ email }: { email: (beforeEmail: ReactNode) => ReactNode }) => email(null),
}))
vi.mock('@/components/auth/EmailCodeForm', () => ({
    EmailCodeForm: () => createElement('form', { 'data-testid': 'email-form' }),
}))
vi.mock('@/components/auth/OAuthSignInButton', () => ({ OAuthSignInButton: () => null }))
vi.mock('@/components/auth/useSignupFunnel', () => ({
    useSignupFunnel: () => ({ setStep: vi.fn(), markConverted: vi.fn(), dismiss: vi.fn() }),
}))
vi.mock('@/cloud/phone', () => ({ PHONE_ENABLED: false }))
vi.mock('@/cloud/phone.client', () => ({ PhoneSignIn: () => null }))
vi.mock('@/lib/auth/oauth-providers', () => ({ ENABLED_OAUTH_PROVIDERS: [], isOAuthProvider: () => false }))
vi.mock('@/stores/onboarding.store', () => ({ useOnboardingStore: (select: (s: { markResume: () => void }) => unknown) => select({ markResume: () => {} }) }))
vi.mock('@/supabase/client', () => ({ createClient: () => ({ auth: {} }) }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useOptionalSession: () => null }))
vi.mock('@rerun/analytics/client', () => ({ setSharedCookie: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const SITE_KEY = '1x00000000000000000000AA'
const rendered: HTMLElement[] = []
const turnstile = {
    render: vi.fn((container: HTMLElement) => {
        rendered.push(container)
        return `widget-${rendered.length}`
    }),
    execute: vi.fn(),
    reset: vi.fn(),
    remove: vi.fn(),
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = SITE_KEY
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // The Cloudflare script is never fetched: appending it is what makes it "loaded".
    vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
        window.turnstile = turnstile
        queueMicrotask(() => (node as HTMLScriptElement).onload?.(new Event('load')))
        return node
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    rendered.length = 0
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.resetModules()
})

// Mounted closed, like SignInPill or ForemanHeader mount AuthDialog: the hook runs first, the form
// shows up later.
async function mountDialogLike(): Promise<(open: boolean) => Promise<void>> {
    const { useAnonymousSignUp } = await import('./useAnonymousSignUp')
    let setOpen: (open: boolean) => void = () => {}
    function DialogLike() {
        const [open, setOpenState] = useState(false)
        setOpen = setOpenState
        const { form } = useAnonymousSignUp({ surface: 'signin_dialog', active: open })
        return open ? createElement('div', { 'data-testid': 'dialog' }, form) : null
    }
    await act(async () => root.render(createElement(DialogLike)))
    return async open => {
        await act(async () => setOpen(open))
        await act(async () => {})
    }
}

describe('useAnonymousSignUp captcha', () => {
    it('draws the Turnstile widget into the form when the form mounts after the hook did', async () => {
        const open = await mountDialogLike()
        expect(host.querySelector('[data-testid="dialog"]')).toBeNull()
        expect(turnstile.render).not.toHaveBeenCalled()

        await open(true)

        const dialog = host.querySelector('[data-testid="dialog"]')
        expect(dialog).not.toBeNull()
        expect(dialog!.querySelector('[data-testid="email-form"]')).not.toBeNull()
        expect(turnstile.render).toHaveBeenCalledTimes(1)
        expect(dialog!.contains(rendered[0])).toBe(true)
    })

    it('draws a fresh widget each time the form is shown again', async () => {
        const open = await mountDialogLike()
        await open(true)
        await open(false)
        expect(turnstile.remove).toHaveBeenCalledWith('widget-1')
        await open(true)
        expect(turnstile.render).toHaveBeenCalledTimes(2)
        expect(host.querySelector('[data-testid="dialog"]')!.contains(rendered[1])).toBe(true)
    })
})
