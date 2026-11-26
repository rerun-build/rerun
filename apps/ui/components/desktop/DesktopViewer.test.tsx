// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopViewer } from '@/components/desktop/DesktopViewer'

// A phone shows the coworker's 1280x720 screen about 375 px wide, so people pinch to enlarge it. noVNC
// sends a pinch to the machine as Ctrl+wheel: Chromium zoomed the page and kept it zoomed per site,
// and the sign-in button left the screen (RER-324). The pinch now enlarges the view on the phone.

type Gesture = { event: string; type: string }

const noVnc = vi.hoisted(() => ({ received: [] as Gesture[], canvas: null as HTMLCanvasElement | null }))

vi.mock('@novnc/novnc/lib/rfb', () => ({
    // Listens on its canvas for the gestures its own GestureHandler dispatches there, as the real one.
    default: class FakeRfb extends EventTarget {
        constructor(target: HTMLElement) {
            super()
            const canvas = document.createElement('canvas')
            target.appendChild(canvas)
            noVnc.canvas = canvas
            for (const event of ['gesturestart', 'gesturemove', 'gestureend']) {
                canvas.addEventListener(event, ev => noVnc.received.push({ event, type: (ev as CustomEvent<{ type: string }>).detail.type }))
            }
        }
        disconnect() {}
    },
}))

const FRAME = { left: 0, top: 0, width: 400, height: 225 }

function gesture(event: string, detail: Record<string, unknown>) {
    act(() => {
        noVnc.canvas!.dispatchEvent(new CustomEvent(event, { detail }))
    })
}

function pinch(from: number, to: number) {
    gesture('gesturestart', { type: 'pinch', clientX: 100, clientY: 50, magnitudeX: from, magnitudeY: 0 })
    gesture('gesturemove', { type: 'pinch', clientX: 100, clientY: 50, magnitudeX: to, magnitudeY: 0 })
    gesture('gestureend', { type: 'pinch', clientX: 100, clientY: 50, magnitudeX: to, magnitudeY: 0 })
}

function drag(dx: number, dy: number) {
    gesture('gesturestart', { type: 'drag', clientX: 200, clientY: 100 })
    gesture('gesturemove', { type: 'drag', clientX: 200 + dx, clientY: 100 + dy })
    gesture('gestureend', { type: 'drag', clientX: 200 + dx, clientY: 100 + dy })
}

const screenOf = () => noVnc.canvas!.parentElement!

let root: Root
let container: HTMLDivElement

async function render(viewOnly = false) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(DesktopViewer, { socketUrl: 'wss://hub.test/desktop', onDisconnect: () => {}, viewOnly })))
    await act(async () => {
        await vi.dynamicImportSettled()
    })
    noVnc.received.length = 0
}

// Reports the frame's size as soon as it is observed, as a browser does once it has laid it out.
class FrameObserver {
    constructor(private readonly onResize: ResizeObserverCallback) {}
    observe(target: Element) {
        this.onResize([{ target, contentRect: { width: FRAME.width, height: FRAME.height } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', FrameObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...FRAME, right: FRAME.width, bottom: FRAME.height, x: 0, y: 0, toJSON: () => ({}) })
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('DesktopViewer gestures', () => {
    it('keeps a pinch from the machine and enlarges the view instead', async () => {
        await render()

        pinch(100, 200)

        expect(noVnc.received).toEqual([])
        expect(screenOf().style.width).toBe('200%')
        expect(screenOf().style.height).toBe('200%')
    })

    it('still sends taps and two-finger scrolls to the machine', async () => {
        await render()

        gesture('gesturestart', { type: 'onetap', clientX: 10, clientY: 10 })
        gesture('gesturestart', { type: 'twodrag', clientX: 10, clientY: 10, magnitudeX: 0, magnitudeY: 0 })
        gesture('gesturemove', { type: 'twodrag', clientX: 10, clientY: 10, magnitudeX: 0, magnitudeY: 120 })

        expect(noVnc.received.map(g => g.type)).toEqual(['onetap', 'twodrag', 'twodrag'])
    })

    it('moves an enlarged view with one finger, and leaves a drag to the machine at rest', async () => {
        await render()
        drag(-50, -30)
        expect(noVnc.received.map(g => g.event)).toEqual(['gesturestart', 'gesturemove', 'gestureend'])
        noVnc.received.length = 0

        pinch(100, 200)
        const before = screenOf().style.transform
        drag(-50, -30)

        expect(noVnc.received).toEqual([])
        expect(screenOf().style.transform).not.toBe(before)
    })

    it('intercepts nothing on a screen that is only watched', async () => {
        await render(true)

        pinch(100, 200)

        expect(noVnc.received.map(g => g.type)).toEqual(['pinch', 'pinch', 'pinch'])
    })
})
