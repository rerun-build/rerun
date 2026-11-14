// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FactoryBarFrame } from './FactoryBarFrame'

let host: HTMLDivElement
let root: Root
type Props = Partial<Parameters<typeof FactoryBarFrame>[0]>
const render = (props: Props = {}) =>
    act(() => {
        root.render(createElement(FactoryBarFrame, { edge: 'bottom', rightInset: 0, ...props }, 'hello bar'))
    })
const outer = () => host.querySelector('[data-bar-frame]') as HTMLElement
const inner = () => outer().firstElementChild as HTMLElement

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe('FactoryBarFrame', () => {
    it('renders its children in an inner frame on the bottom edge', () => {
        render()
        const el = host.querySelector('[data-bar-frame="bottom"]') as HTMLElement
        expect(el).not.toBeNull()
        expect(el.className).toContain('bottom-0')
        expect(el.className).not.toContain('top-0')
        expect(inner().tagName).toBe('DIV')
        expect(inner().textContent).toBe('hello bar')
    })
    it('sits on the top edge when asked', () => {
        render({ edge: 'top' })
        expect(outer().getAttribute('data-bar-frame')).toBe('top')
        expect(outer().className).toContain('top-0')
        expect(outer().className).not.toContain('bottom-0')
    })
    it('is centred in what a side panel leaves: right is the inset', () => {
        render({ rightInset: 380 })
        expect(outer().style.right).toBe('380px')
        render({ rightInset: 0 })
        expect(outer().style.right).toBe('0px')
        render({ rightInset: 640 })
        expect(outer().style.right).toBe('640px')
    })
    it('hands its inner frame to the caller', () => {
        const frameRef = createRef<HTMLDivElement>()
        render({ frameRef, className: 'extra-x' })
        expect(frameRef.current).toBe(inner())
        expect(inner().className).toContain('extra-x')
        expect(outer().className).not.toContain('extra-x')
    })
    it('only the inner frame takes pointer events', () => {
        render()
        expect(outer().className).toContain('pointer-events-none')
        expect(inner().className).toContain('pointer-events-auto')
    })
})
