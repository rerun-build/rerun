// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

const actions = vi.hoisted(() => ({ startGrokSignInAction: vi.fn(), pollGrokSignInAction: vi.fn() }))
vi.mock('@/app/api/_actions/workspace-connection.actions', () => actions)
vi.mock('@/lib/engine/ai-connection-analytics', () => ({ trackAiConnectionFailed: vi.fn() }))
vi.mock('@rerun/ui/foreman', () => ({ Orb: () => null }))
// The track's cursor and bubbles animate; happy-dom cancels each animation with an AbortError.
vi.mock('motion/react', async () => {
    const { createElement: h, forwardRef } = await import('react')
    const strip = ({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => rest
    const element = (tag: string) => forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => h(tag, { ...strip(props), ref }))
    return { LayoutGroup: ({ children }: { children: unknown }) => children, AnimatePresence: ({ children }: { children: unknown }) => children, motion: new Proxy({}, { get: (_target, tag: string) => element(tag) }) }
})

const { PlanConnect } = await import('./PlanConnect')

const STARTED = { ok: true, ticket: 'sealed-ticket', userCode: 'N4FS-5STQ', verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=N4FS-5STQ', pollIntervalMs: 5000, expiresAt: Date.now() + 1_800_000 }

let container: HTMLDivElement
let root: Root
type Mutation = { success: boolean; error?: string }
let onSignedIn: ReturnType<typeof vi.fn<(connectionId: string) => Promise<Mutation>>>
let onKeys: ReturnType<typeof vi.fn<(keys: Record<string, string>) => Promise<Mutation>>>
const open = vi.fn()

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.stubGlobal('open', open)
    actions.startGrokSignInAction.mockResolvedValue(STARTED)
    actions.pollGrokSignInAction.mockResolvedValue({ status: 'pending' })
    onSignedIn = vi.fn(async () => ({ success: true }))
    onKeys = vi.fn(async () => ({ success: true }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(TooltipProvider, null, createElement(PlanConnect, { provider: 'grok', onKeys, onSignedIn, target: { name: 'Grok' }, surface: 'add_provider', lastStep: linked => ({ title: linked ? 'Linked' : 'Name it' }) }))))
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

const button = (label: string) => [...container.querySelectorAll('button')].find(element => element.textContent?.includes(label))

async function getCode() {
    await act(async () => button('Get code')!.click())
}

async function tick() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
    })
}

describe('the Grok sign-in of the AI providers panel', () => {
    it('hands out a code to type on xAI, and opens xAI on it', async () => {
        expect(container.textContent).toContain('Get a code from xAI')
        await getCode()
        expect(container.textContent).toContain('N4FS-5STQ')
        expect(container.textContent).toContain('Waiting for xAI')
        expect(open).toHaveBeenCalledWith(STARTED.verificationUrl, '_blank', 'noopener,noreferrer')
        expect(container.querySelector('a[href="https://accounts.x.ai/oauth2/device?user_code=N4FS-5STQ"]')).not.toBeNull()
    })

    it('polls with the ticket and where the sign-in lands, then hands over the connection, never a key', async () => {
        await getCode()
        await tick()
        expect(actions.pollGrokSignInAction).toHaveBeenCalledWith({ ticket: 'sealed-ticket', name: 'Grok' })
        expect(onSignedIn).not.toHaveBeenCalled()

        actions.pollGrokSignInAction.mockResolvedValue({ status: 'connected', connectionId: 'cnx-grok' })
        await tick()
        expect(onSignedIn).toHaveBeenCalledWith('cnx-grok')
        expect(onKeys).not.toHaveBeenCalled()
        expect(container.textContent).toContain('Linked')
    })

    it('says why the sign-in did not go through, and offers a new code', async () => {
        await getCode()
        actions.pollGrokSignInAction.mockResolvedValue({ status: 'error', error: 'The sign-in was declined on xAI. Start it again to connect Grok.', code: 'grokSignInDenied' })
        await tick()
        expect(container.textContent).toContain('The sign-in was declined on xAI.')
        expect(button('Get a new code')).toBeDefined()
        expect(onSignedIn).not.toHaveBeenCalled()
    })

    it('polls through a refusal of the moment, so an approval given meanwhile still lands', async () => {
        await getCode()
        actions.pollGrokSignInAction.mockResolvedValueOnce({ status: 'error', error: 'Not authenticated', code: 'generic' })
        await tick()
        expect(container.textContent).not.toContain('Not authenticated')
        actions.pollGrokSignInAction.mockResolvedValue({ status: 'connected', connectionId: 'cnx-grok' })
        await tick()
        expect(onSignedIn).toHaveBeenCalledWith('cnx-grok')
    })

    it('gives up after a run of failures, and says why', async () => {
        await getCode()
        actions.pollGrokSignInAction.mockResolvedValue({ status: 'error', error: 'Not authenticated' })
        for (let i = 0; i < 6; i++) await tick()
        expect(container.textContent).toContain('Not authenticated')
        expect(button('Get a new code')).toBeDefined()
    })

    it('counts failures in a row only: a poll that goes through starts the count again', async () => {
        await getCode()
        for (let round = 0; round < 2; round++) {
            for (let i = 0; i < 5; i++) actions.pollGrokSignInAction.mockResolvedValueOnce({ status: 'error', error: 'Not authenticated' })
            actions.pollGrokSignInAction.mockResolvedValueOnce({ status: 'pending' })
        }
        for (let i = 0; i < 12; i++) await tick()
        expect(container.textContent).not.toContain('Not authenticated')
        expect(actions.pollGrokSignInAction).toHaveBeenCalledTimes(12)
    })

    it('polls further apart, for good, once xAI asks it to slow down', async () => {
        await getCode()
        actions.pollGrokSignInAction.mockResolvedValueOnce({ status: 'pending', slowDown: true })
        await tick()
        expect(actions.pollGrokSignInAction).toHaveBeenCalledTimes(1)
        await tick()
        expect(actions.pollGrokSignInAction).toHaveBeenCalledTimes(1)
        await tick()
        expect(actions.pollGrokSignInAction).toHaveBeenCalledTimes(2)
        await tick()
        expect(actions.pollGrokSignInAction).toHaveBeenCalledTimes(2)
        await tick()
        expect(actions.pollGrokSignInAction).toHaveBeenCalledTimes(3)
    })

    it('says the machine has to update when its engine does not run Grok', async () => {
        actions.startGrokSignInAction.mockResolvedValue({ ok: false, error: 'Grok arrives with the next update of this machine. Try again in a little while.', code: 'grokNeedsUpdate' })
        await getCode()
        expect(container.textContent).toContain('Grok arrives with the next update of this machine.')
        expect(open).not.toHaveBeenCalled()
    })
})
