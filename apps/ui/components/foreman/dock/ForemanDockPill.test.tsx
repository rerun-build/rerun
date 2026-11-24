// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useForemanName', () => ({ useForemanName: () => ({ name: 'Chief of Staff', named: 'no' }) }))
vi.mock('@/hooks/usePageAttention', () => ({ usePageAttention: () => 'focused' }))
vi.mock('./ForemanPillVoice', () => ({ ForemanPillVoice: () => null }))
vi.mock('./ForemanPillTicker', () => ({ ForemanPillTicker: () => null }))

const { ForemanDockPill } = await import('./ForemanDockPill')

// The pill stays mounted while it is hidden: always on a phone, and under the open column on a desktop.
// Its placeholder kept typing there, a render every 16 to 42 ms for nobody (RER-291).

const LONG_ENOUGH_TO_TYPE_MS = 10_000

let container: HTMLDivElement
let root: Root

const render = (hidden: boolean) =>
    act(() => root.render(createElement(ForemanDockPill, { side: 'right', mode: { kind: 'field' }, hidden, mod: '⌘', inputRef: { current: null }, onSubmit: vi.fn(), onEngage: vi.fn() })))
const placeholder = () => container.querySelector('input')!.placeholder
const wait = () => {
    const seen = new Set([placeholder()])
    for (let elapsed = 0; elapsed < LONG_ENOUGH_TO_TYPE_MS; elapsed += 20) {
        act(() => vi.advanceTimersByTime(20))
        seen.add(placeholder())
    }
    return seen.size
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
})

describe('the placeholder of the Chief of Staff pill', () => {
    it('types while the pill is on screen', () => {
        render(false)
        expect(wait()).toBeGreaterThan(10)
    })

    it('stands still while the pill is hidden', () => {
        render(true)
        expect(wait()).toBe(1)
    })

    it('takes up where it stopped when the pill comes back', () => {
        render(false)
        act(() => vi.advanceTimersByTime(2_600))
        act(() => vi.advanceTimersByTime(100))
        const stopped = placeholder()
        render(true)
        expect(wait()).toBe(1)
        expect(placeholder()).toBe(stopped)
        render(false)
        expect(placeholder()).toBe(stopped)
        expect(wait()).toBeGreaterThan(10)
    })
})
