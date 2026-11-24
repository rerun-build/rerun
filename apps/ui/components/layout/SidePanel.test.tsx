// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDE_PANEL_SHEET_DETENT_STORAGE_KEY } from '@/lib/side-panel-width'
import { useBoardCoverStore } from '@/stores/board-cover.store'
import { SidePanel } from './SidePanel'

// On a phone a coworker's panel is a sheet over the board. Nothing told the board, which kept animating
// behind a chat left open (RER-291).

const PHONE = 390
const PHONE_HEIGHT = 844
const DESKTOP = 1440
const SHEET_MS = 500
const GRAB_Y = 100
const PULL = 50

let container: HTMLDivElement
let root: Root
let mounted: boolean

const setViewport = (width: number) => (window as unknown as { happyDOM: { setViewport: (size: { width: number; height: number }) => void } }).happyDOM.setViewport({ width, height: PHONE_HEIGHT })
const covers = () => useBoardCoverStore.getState().covers
const panel: ComponentProps<typeof SidePanel> = { isOpen: false, onDismiss: vi.fn(), children: null }
const render = (isOpen: boolean) => act(() => root.render(createElement(SidePanel, { ...panel, isOpen })))
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const resize = (width: number) => act(() => setViewport(width))
const grabber = () => container.querySelector<HTMLButtonElement>('[data-sheet-grabber]')!
const toggleDetent = () => act(() => grabber().click())
const pointer = (type: string, target: EventTarget, y: number, at: number) =>
    act(() => {
        const event = new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientY: y })
        Object.defineProperty(event, 'timeStamp', { value: at })
        target.dispatchEvent(event)
    })
const pullDown = () => {
    vi.spyOn(container.querySelector('[data-side-panel]')!, 'getBoundingClientRect').mockReturnValue({ height: PHONE_HEIGHT } as DOMRect)
    pointer('pointerdown', grabber(), GRAB_Y, 1_000)
    pointer('pointermove', window, GRAB_Y + PULL, 1_400)
}
// Held still before the finger lifts: a flick would throw the sheet down to its half height.
const letGo = () => {
    pointer('pointermove', window, GRAB_Y + PULL, 1_800)
    pointer('pointerup', window, GRAB_Y + PULL, 1_800)
}
const unmount = () => {
    if (mounted) act(() => root.unmount())
    mounted = false
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    localStorage.clear()
    useBoardCoverStore.setState({ covers: 0 })
    setViewport(PHONE)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mounted = true
})

afterEach(() => {
    unmount()
    container.remove()
    vi.useRealTimers()
})

describe('the board under a coworker sheet', () => {
    it('is covered once the full sheet has finished sliding up', () => {
        render(true)
        wait(SHEET_MS - 1)
        expect(covers()).toBe(0)
        wait(1)
        expect(covers()).toBe(1)
    })

    it('is uncovered as soon as the sheet closes', () => {
        render(true)
        wait(SHEET_MS)
        render(false)
        expect(covers()).toBe(0)
    })

    it('stays live above a half-height sheet', () => {
        localStorage.setItem(SIDE_PANEL_SHEET_DETENT_STORAGE_KEY, 'medium')
        render(true)
        wait(SHEET_MS)
        expect(covers()).toBe(0)
    })

    it('follows the sheet between its two heights', () => {
        render(true)
        wait(SHEET_MS)
        toggleDetent()
        expect(covers()).toBe(0)
        toggleDetent()
        wait(SHEET_MS)
        expect(covers()).toBe(1)
    })

    it('is live again while the sheet is being pulled down', () => {
        render(true)
        wait(SHEET_MS)
        pullDown()
        expect(covers()).toBe(0)
    })

    it('is covered again once the sheet has settled back at its full height', () => {
        render(true)
        wait(SHEET_MS)
        pullDown()
        letGo()
        wait(SHEET_MS - 1)
        expect(covers()).toBe(0)
        wait(1)
        expect(covers()).toBe(1)
    })

    it('is never covered by the panel of a desktop', () => {
        resize(DESKTOP)
        render(true)
        wait(SHEET_MS)
        expect(covers()).toBe(0)
    })

    it('is uncovered when the window grows past the phone width', () => {
        render(true)
        wait(SHEET_MS)
        // happy-dom only reports a query that stops matching once it has reported that it matched.
        act(() => window.dispatchEvent(new Event('resize')))
        resize(DESKTOP)
        expect(covers()).toBe(0)
    })

    it('is not covered by a closed sheet', () => {
        render(false)
        wait(SHEET_MS)
        expect(covers()).toBe(0)
    })

    it('never counts a sheet closed before it finished opening', () => {
        render(true)
        wait(SHEET_MS / 2)
        render(false)
        wait(SHEET_MS)
        expect(covers()).toBe(0)
    })

    it('is uncovered when the panel goes away', () => {
        render(true)
        wait(SHEET_MS)
        unmount()
        expect(covers()).toBe(0)
    })

    it('leaves a dialog its own cover', () => {
        const release = useBoardCoverStore.getState().cover()
        render(true)
        wait(SHEET_MS)
        expect(covers()).toBe(2)
        render(false)
        expect(covers()).toBe(1)
        act(release)
    })
})
