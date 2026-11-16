// @vitest-environment happy-dom
import type { DesktopWindowState } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shell = vi.hoisted(() => ({ current: null as null | { onState: (state: DesktopWindowState) => void; state: DesktopWindowState } }))

vi.mock('./client', () => ({
    desktopShell: () =>
        shell.current && {
            window: {
                getState: async () => shell.current?.state,
                onState: (callback: (state: DesktopWindowState) => void) => {
                    if (shell.current) shell.current.onState = callback
                    return () => {}
                },
            },
        },
}))

const windowState = (patch: Partial<DesktopWindowState>): DesktopWindowState => ({ focused: true, visible: true, fullscreen: false, maximized: false, ...patch })

function setVisibility(value: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
}

async function load() {
    vi.resetModules()
    return import('./attention')
}

describe('page attention in a browser', () => {
    let focused = true

    beforeEach(() => {
        shell.current = null
        focused = true
        vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
        setVisibility('visible')
    })

    afterEach(() => vi.restoreAllMocks())

    it('follows the focus and the visibility of the tab', async () => {
        const { pageAttention, subscribePageAttention } = await load()
        const seen: string[] = []
        const stop = subscribePageAttention(() => seen.push(pageAttention()))
        expect(pageAttention()).toBe('focused')

        focused = false
        window.dispatchEvent(new Event('blur'))
        setVisibility('hidden')
        setVisibility('visible')
        focused = true
        window.dispatchEvent(new Event('focus'))
        stop()
        window.dispatchEvent(new Event('blur'))

        expect(seen).toEqual(['visible', 'hidden', 'visible', 'focused'])
    })

    it('tells a poll only when the page is hidden or shown again, not when the focus moves away', async () => {
        const { onPageShownOrHidden } = await load()
        const flips: boolean[] = []
        const stop = onPageShownOrHidden(shown => flips.push(shown))

        focused = false
        window.dispatchEvent(new Event('blur'))
        setVisibility('hidden')
        setVisibility('visible')
        stop()

        expect(flips).toEqual([false, true])
    })
})

describe('page attention in the desktop app', () => {
    beforeEach(() => {
        shell.current = { onState: () => {}, state: windowState({}) }
        vi.spyOn(document, 'hasFocus').mockReturnValue(true)
        setVisibility('visible')
    })

    afterEach(() => vi.restoreAllMocks())

    it('reads the window, whose document stays visible when it is hidden in the tray', async () => {
        const { pageAttention, onPageShownOrHidden } = await load()
        const flips: boolean[] = []
        onPageShownOrHidden(shown => flips.push(shown))
        await Promise.resolve()

        shell.current?.onState(windowState({ focused: false }))
        expect(pageAttention()).toBe('visible')
        shell.current?.onState(windowState({ focused: false, visible: false }))
        expect(pageAttention()).toBe('hidden')
        expect(document.visibilityState).toBe('visible')
        shell.current?.onState(windowState({}))
        expect(pageAttention()).toBe('focused')

        expect(flips).toEqual([false, true])
    })
})
