// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const track = vi.hoisted(() => vi.fn())
vi.mock('@rerun/analytics/client', () => ({ track }))

type Callbacks = Record<string, (value?: string) => void>

const turnstileCallbacks: Callbacks[] = []
const turnstile = {
    render: vi.fn((_container: HTMLElement, options: object) => {
        turnstileCallbacks.push(options as Callbacks)
        return 'turnstile-1'
    }),
    execute: vi.fn(),
    reset: vi.fn(),
    remove: vi.fn(),
}

const hcaptchaCallbacks: Callbacks[] = []
const hcaptchaContainers: HTMLElement[] = []
const hcaptcha = {
    render: vi.fn((container: HTMLElement, options: object) => {
        hcaptchaContainers.push(container)
        hcaptchaCallbacks.push(options as Callbacks)
        return 'hcaptcha-1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
}

let root: Root
let host: HTMLDivElement
let captcha: { getToken: () => Promise<unknown>; challenging: boolean }

type ScriptMode = 'ready' | 'error' | 'silent'
const scripts: { turnstile: ScriptMode; hcaptcha: ScriptMode } = { turnstile: 'ready', hcaptcha: 'ready' }

beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'turnstile-site'
    process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY = 'hcaptcha-site'
    scripts.turnstile = 'ready'
    scripts.hcaptcha = 'ready'
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
        const script = node as HTMLScriptElement
        const vendor = script.src.includes('hcaptcha') ? 'hcaptcha' : 'turnstile'
        const mode = scripts[vendor]
        if (mode === 'error') queueMicrotask(() => script.onerror?.(new Event('error')))
        if (mode === 'ready' && vendor === 'turnstile') {
            window.turnstile = turnstile
            queueMicrotask(() => script.onload?.(new Event('load')))
        }
        if (mode === 'ready' && vendor === 'hcaptcha') {
            window.hcaptcha = hcaptcha
            const ready = new URL(script.src).searchParams.get('onload')!
            queueMicrotask(() => (window as unknown as Record<string, () => void>)[ready]!())
        }
        return node
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    turnstileCallbacks.length = 0
    hcaptchaCallbacks.length = 0
    hcaptchaContainers.length = 0
    delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.resetModules()
    vi.useRealTimers()
})

async function mount() {
    const { useCaptcha } = await import('./useCaptcha')
    function Form() {
        const { containerRef, challenging, getToken } = useCaptcha()
        captcha = { getToken, challenging }
        return createElement('div', { ref: containerRef })
    }
    await act(async () => root.render(createElement(Form)))
    await act(async () => {})
}

async function settle() {
    await act(async () => {})
    await act(async () => {})
}

describe('useCaptcha', () => {
    it('hands over the token of the invisible check when Cloudflare vouches for the visitor', async () => {
        await mount()
        const token = captcha.getToken()
        await settle()
        expect(turnstile.execute).toHaveBeenCalledWith('turnstile-1')

        turnstileCallbacks[0]!.callback!('cf-token')

        await expect(token).resolves.toEqual({ provider: 'turnstile', token: 'cf-token' })
        expect(hcaptcha.render).not.toHaveBeenCalled()
    })

    it('hands the visitor the puzzle when Cloudflare refuses them', async () => {
        await mount()
        const token = captcha.getToken()
        await settle()

        await act(async () => turnstileCallbacks[0]!['error-callback']!('600010'))
        await settle()

        expect(hcaptcha.render).toHaveBeenCalledTimes(1)
        expect(host.contains(hcaptchaContainers[0]!)).toBe(true)
        expect(captcha.challenging).toBe(true)
        expect(turnstile.remove).toHaveBeenCalledWith('turnstile-1')
        expect(track).toHaveBeenCalledWith('captcha_puzzle_shown', { turnstile_reason: 'captcha_failed', turnstile_code: '600010' })

        await act(async () => hcaptchaCallbacks[0]!.callback!('puzzle-token'))

        await expect(token).resolves.toEqual({ provider: 'hcaptcha', token: 'puzzle-token' })
        await settle()
        expect(captcha.challenging).toBe(false)
    })

    it('goes straight to the puzzle on the next send once Cloudflare refused', async () => {
        await mount()
        const first = captcha.getToken()
        await settle()
        await act(async () => turnstileCallbacks[0]!['error-callback']!('600010'))
        await settle()
        await act(async () => hcaptchaCallbacks[0]!.callback!('puzzle-token'))
        await first
        turnstile.execute.mockClear()

        const second = captcha.getToken()
        await settle()

        expect(turnstile.execute).not.toHaveBeenCalled()
        expect(hcaptcha.reset).toHaveBeenCalledWith('hcaptcha-1')
        await act(async () => hcaptchaCallbacks[0]!.callback!('second-token'))
        await expect(second).resolves.toEqual({ provider: 'hcaptcha', token: 'second-token' })
    })

    it('keeps the old dead end when no puzzle is configured', async () => {
        delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY
        await mount()
        const refused = expect(captcha.getToken()).rejects.toMatchObject({ provider: 'turnstile', reason: 'captcha_failed', code: '600010' })
        await settle()

        await act(async () => turnstileCallbacks[0]!['error-callback']!('600010'))

        await refused
        expect(hcaptcha.render).not.toHaveBeenCalled()
    })

    it('hands the visitor the puzzle once Cloudflare stays silent for 8 seconds', async () => {
        vi.useFakeTimers()
        await mount()
        const token = captcha.getToken()
        await settle()

        await act(async () => vi.advanceTimersByTime(8_000))
        await settle()

        expect(hcaptcha.render).toHaveBeenCalledTimes(1)
        expect(track).toHaveBeenCalledWith('captcha_puzzle_shown', { turnstile_reason: 'captcha_timeout', turnstile_code: undefined })

        await act(async () => hcaptchaCallbacks[0]!.callback!('puzzle-token'))
        await expect(token).resolves.toEqual({ provider: 'hcaptcha', token: 'puzzle-token' })
    })

    it('waits 20 seconds for a silent Cloudflare when no puzzle is configured', async () => {
        delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY
        vi.useFakeTimers()
        await mount()
        let outcome: 'pending' | 'settled' = 'pending'
        const token = captcha.getToken()
        token.then(
            () => (outcome = 'settled'),
            () => (outcome = 'settled')
        )
        await settle()

        await act(async () => vi.advanceTimersByTime(8_000))
        await settle()
        expect(outcome).toBe('pending')
        expect(hcaptcha.render).not.toHaveBeenCalled()

        await act(async () => vi.advanceTimersByTime(12_000))
        await expect(token).rejects.toMatchObject({ provider: 'turnstile', reason: 'captcha_timeout' })
    })

    it('fetches the puzzle script again on the next send when it failed to load', async () => {
        scripts.hcaptcha = 'error'
        await mount()
        const refused = expect(captcha.getToken()).rejects.toMatchObject({ provider: 'hcaptcha', reason: 'captcha_failed', code: 'script' })
        await settle()
        await act(async () => turnstileCallbacks[0]!['error-callback']!('600010'))

        await refused
        expect(hcaptcha.render).not.toHaveBeenCalled()

        scripts.hcaptcha = 'ready'
        const second = captcha.getToken()
        await settle()

        expect(hcaptcha.render).toHaveBeenCalledTimes(1)
        await act(async () => hcaptchaCallbacks[0]!.callback!('puzzle-token'))
        await expect(second).resolves.toEqual({ provider: 'hcaptcha', token: 'puzzle-token' })
    })

    it('gives up on a puzzle whose script never arrives, after 20 seconds', async () => {
        vi.useFakeTimers()
        scripts.hcaptcha = 'silent'
        await mount()
        const refused = expect(captcha.getToken()).rejects.toMatchObject({ provider: 'hcaptcha', reason: 'captcha_timeout', code: 'script' })
        await settle()
        await act(async () => turnstileCallbacks[0]!['error-callback']!('600010'))
        await settle()
        expect(captcha.challenging).toBe(true)

        await act(async () => vi.advanceTimersByTime(20_000))

        await refused
        await settle()
        expect(captcha.challenging).toBe(false)
        expect(hcaptcha.render).not.toHaveBeenCalled()
    })

    it('resets the puzzle before the next send once hCaptcha reported an error', async () => {
        await mount()
        const refused = expect(captcha.getToken()).rejects.toMatchObject({ provider: 'hcaptcha', reason: 'captcha_failed', code: 'network-error' })
        await settle()
        await act(async () => turnstileCallbacks[0]!['error-callback']!('600010'))
        await settle()
        await act(async () => hcaptchaCallbacks[0]!['error-callback']!('network-error'))
        await refused
        expect(hcaptcha.reset).not.toHaveBeenCalled()

        const second = captcha.getToken()
        await settle()

        expect(hcaptcha.reset).toHaveBeenCalledWith('hcaptcha-1')
        await act(async () => hcaptchaCallbacks[0]!.callback!('puzzle-token'))
        await expect(second).resolves.toEqual({ provider: 'hcaptcha', token: 'puzzle-token' })
    })

    it('fetches the Cloudflare script again on the next send when it failed to load', async () => {
        delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY
        scripts.turnstile = 'error'
        await mount()

        await expect(captcha.getToken()).rejects.toMatchObject({ provider: 'turnstile', reason: 'captcha_failed', code: 'script' })
        expect(turnstile.render).not.toHaveBeenCalled()

        scripts.turnstile = 'ready'
        const token = captcha.getToken()
        await settle()

        expect(turnstile.execute).toHaveBeenCalledWith('turnstile-1')
        turnstileCallbacks[0]!.callback!('cf-token')
        await expect(token).resolves.toEqual({ provider: 'turnstile', token: 'cf-token' })
    })
})
