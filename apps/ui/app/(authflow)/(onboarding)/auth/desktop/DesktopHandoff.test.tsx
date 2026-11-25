// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.hoisted(() => vi.fn())

vi.mock('@/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }))
vi.mock('./actions', () => ({ approveDesktopSignIn: vi.fn() }))
vi.mock('@/components/onboarding/OnboardingPage', () => ({ OnboardingPage: ({ children }: { children: ReactNode }) => children, OnboardingStepLayout: ({ children }: { children?: ReactNode }) => children, OnboardingHeading: () => null }))

const { DesktopHandoff } = await import('./DesktopHandoff')

let container: HTMLDivElement
let root: Root
let visited: string[]

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    signOut.mockReset().mockResolvedValue({ error: null })
    visited = []
    window.history.replaceState(null, '', '/auth/desktop?state=s')
    vi.spyOn(window.location, 'href', 'set').mockImplementation(url => void visited.push(url))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
})

describe('DesktopHandoff', () => {
    it('switches account in this browser only, then comes back to the hand-off', async () => {
        await act(async () => root.render(createElement(DesktopHandoff, { challenge: 'c', state: 's', channel: 'stable', provider: null, account: 'owner@acme.test' })))
        await act(async () => [...container.querySelectorAll('button')].at(-1)?.click())

        expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
        expect(visited).toEqual(['/auth?next=%2Fauth%2Fdesktop%3Fstate%3Ds'])
    })
})
