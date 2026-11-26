// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

const { ColorPicker } = await import('./color-picker')

let container: HTMLDivElement
let root: Root
const sent: string[] = []

function Host() {
    const [value, setValue] = useState('#ff7a00')
    return createElement(ColorPicker, {
        value,
        onChange: (hex: string) => {
            sent.push(hex)
            setValue(hex)
        },
    })
}

const field = () => container.querySelector<HTMLInputElement>('input[aria-label="Hex color"]')!

function type(text: string) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
        setValue.call(field(), text)
        field().dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function typeKeys(text: string) {
    type('')
    for (let end = 1; end <= text.length; end++) type(text.slice(0, end))
}

const leave = () => act(() => field().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    sent.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(Host)))
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('ColorPicker, the hex field', () => {
    it('takes a colour typed key by key, without reading its first three keys as a short hex', () => {
        typeKeys('0e9f8e')

        expect(field().value).toBe('0e9f8e')
        expect(sent).toEqual(['#0e9f8e'])
    })

    it('reads a short hex once the field is left', () => {
        typeKeys('f70')
        expect(sent).toEqual([])

        leave()
        expect(field().value).toBe('#ff7700')
        expect(sent).toEqual(['#ff7700'])
    })

    it('puts back the colour it shows when what was typed is not one', () => {
        typeKeys('zz')
        leave()

        expect(field().value).toBe('#ff7a00')
        expect(sent).toEqual([])
    })
})
