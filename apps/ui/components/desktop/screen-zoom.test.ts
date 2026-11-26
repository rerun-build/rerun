import { describe, expect, it } from 'vitest'

import { panView, SCREEN_VIEW_AT_REST, screenPlacement, zoomView, type ScreenView, type Size } from '@/components/desktop/screen-zoom'

const ASPECT = 16 / 9
const FRAME = { width: 400, height: 225 }
const PHONE = { width: 375, height: 560 }
const PHONE_WITH_KEYBOARD = { width: 375, height: 260 }

// Where noVNC paints the screen in the frame: fitted in its element without stretching, and centered.
function screenRect(view: ScreenView, frame: Size) {
    const { scale, x, y } = screenPlacement(view, frame, ASPECT)
    const element = { width: frame.width * scale, height: frame.height * scale }
    const width = Math.min(element.width, element.height * ASPECT)
    const height = width / ASPECT
    const left = x + (element.width - width) / 2
    const top = y + (element.height - height) / 2
    return { left, top, right: left + width, bottom: top + height, width, height }
}

function expectPlacement(view: ScreenView, frame: Size, expected: { scale: number; x: number; y: number }) {
    const placement = screenPlacement(view, frame, ASPECT)
    expect(placement.scale).toBe(expected.scale)
    expect(placement.x).toBeCloseTo(expected.x)
    expect(placement.y).toBeCloseTo(expected.y)
}

const pointInTheMiddle = (view: ScreenView, frame: Size) => {
    const rect = screenRect(view, frame)
    return { x: (frame.width / 2 - rect.left) / rect.width, y: (frame.height / 2 - rect.top) / rect.height }
}

describe('zoomView', () => {
    it('keeps the point under the fingers where it was', () => {
        expectPlacement(zoomView(SCREEN_VIEW_AT_REST, 2, { x: 100, y: 50 }, FRAME, ASPECT), FRAME, { scale: 2, x: -100, y: -50 })
    })

    it('never shrinks the screen below the frame nor enlarges it past four times', () => {
        expect(zoomView(SCREEN_VIEW_AT_REST, 0.5, { x: 10, y: 10 }, FRAME, ASPECT)).toEqual(SCREEN_VIEW_AT_REST)
        expect(zoomView(SCREEN_VIEW_AT_REST, 9, { x: 0, y: 0 }, FRAME, ASPECT).scale).toBe(4)
    })

    it('keeps the frame covered when zoomed at a corner', () => {
        expectPlacement(zoomView(SCREEN_VIEW_AT_REST, 3, { x: 400, y: 225 }, FRAME, ASPECT), FRAME, { scale: 3, x: -800, y: -450 })
    })

    it('comes back to rest when pinched back to its size', () => {
        const zoomed = zoomView(SCREEN_VIEW_AT_REST, 2, { x: 300, y: 200 }, FRAME, ASPECT)

        expect(zoomView(zoomed, 1, { x: 300, y: 200 }, FRAME, ASPECT)).toEqual(SCREEN_VIEW_AT_REST)
    })
})

describe('panView', () => {
    it('moves an enlarged view with the finger, up to its edges', () => {
        const zoomed = zoomView(SCREEN_VIEW_AT_REST, 2, { x: 100, y: 50 }, FRAME, ASPECT)

        expectPlacement(panView(zoomed, -50, -30, FRAME, ASPECT), FRAME, { scale: 2, x: -150, y: -80 })
        expectPlacement(panView(zoomed, 500, 500, FRAME, ASPECT), FRAME, { scale: 2, x: 0, y: 0 })
        expectPlacement(panView(zoomed, -1000, -1000, FRAME, ASPECT), FRAME, { scale: 2, x: -400, y: -225 })
    })

    it('does not move a screen at rest', () => {
        expect(panView(SCREEN_VIEW_AT_REST, -50, 40, FRAME, ASPECT)).toEqual(SCREEN_VIEW_AT_REST)
    })
})

// Held upright, a phone shows the 16:9 screen across its width with empty bands above and below.
describe('on a phone held upright', () => {
    it('shows the whole screen at rest, centered', () => {
        expectPlacement(SCREEN_VIEW_AT_REST, PHONE, { scale: 1, x: 0, y: 0 })
        expect(screenRect(SCREEN_VIEW_AT_REST, PHONE).top).toBeCloseTo((PHONE.height - PHONE.width / ASPECT) / 2)
    })

    it('never moves an enlarged screen off the frame, whichever way the finger goes', () => {
        const zoomed = zoomView(SCREEN_VIEW_AT_REST, 4, { x: 187, y: 280 }, PHONE, ASPECT)

        for (const [dx, dy] of [[0, 5000], [0, -5000], [5000, 0], [-5000, 0]]) {
            const rect = screenRect(panView(zoomed, dx, dy, PHONE, ASPECT), PHONE)
            expect(rect.top).toBeLessThanOrEqual(1e-9)
            expect(rect.bottom).toBeGreaterThanOrEqual(PHONE.height - 1e-9)
            expect(rect.left).toBeLessThanOrEqual(1e-9)
            expect(rect.right).toBeGreaterThanOrEqual(PHONE.width - 1e-9)
        }
    })

    it('keeps a screen still shorter than the frame centered from top to bottom', () => {
        const zoomed = zoomView(SCREEN_VIEW_AT_REST, 2, { x: 187, y: 100 }, PHONE, ASPECT)
        const rect = screenRect(panView(zoomed, 0, 300, PHONE, ASPECT), PHONE)

        expect(rect.top).toBeCloseTo((PHONE.height - rect.height) / 2)
    })

    it('keeps the same point of the screen in the middle when the keyboard opens', () => {
        const zoomed = zoomView(SCREEN_VIEW_AT_REST, 4, { x: 187, y: 300 }, PHONE, ASPECT)
        const before = pointInTheMiddle(zoomed, PHONE)
        const after = pointInTheMiddle(zoomed, PHONE_WITH_KEYBOARD)

        expect(after.x).toBeCloseTo(before.x)
        expect(after.y).toBeCloseTo(before.y)
        const rect = screenRect(zoomed, PHONE_WITH_KEYBOARD)
        expect(rect.top).toBeLessThanOrEqual(1e-9)
        expect(rect.bottom).toBeGreaterThanOrEqual(PHONE_WITH_KEYBOARD.height - 1e-9)
    })

    it('keeps a view pushed to an edge covering the frame once the keyboard closes', () => {
        const atTheBottom = panView(zoomView(SCREEN_VIEW_AT_REST, 4, { x: 187, y: 130 }, PHONE_WITH_KEYBOARD, ASPECT), 0, -5000, PHONE_WITH_KEYBOARD, ASPECT)
        const rect = screenRect(atTheBottom, PHONE)

        expect(rect.bottom).toBeCloseTo(PHONE.height)
        expect(rect.top).toBeLessThanOrEqual(1e-9)
    })
})
