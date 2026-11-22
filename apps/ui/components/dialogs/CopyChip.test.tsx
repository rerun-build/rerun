// @vitest-environment happy-dom
import { act, createElement, createRef, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

const { CopyChip } = await import('./CopyChip')

let container: HTMLDivElement
let root: Root
const writeText = vi.fn((_value: string) => Promise.resolve())

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

async function mount(value: string, pasteTarget?: RefObject<HTMLInputElement | null>) {
    await act(async () => root.render(createElement(CopyChip, { value, pasteTarget })))
    const chip = container.querySelector<HTMLElement>('[role="button"]')
    if (!chip) throw new Error('no chip')
    return chip
}

const showsCheck = () => !!container.querySelector('svg.text-emerald-500')

describe('CopyChip', () => {
    it('copies the exact value on click and confirms with a check', async () => {
        const chip = await mount('Launchs Rerun')
        expect(chip.getAttribute('aria-label')).toBe('Copy Launchs Rerun')
        expect(showsCheck()).toBe(false)

        await act(async () => chip.click())

        expect(writeText).toHaveBeenCalledWith('Launchs Rerun')
        expect(showsCheck()).toBe(true)
    })

    it('copies from the keyboard with Enter and Space', async () => {
        const chip = await mount('DELETE')

        for (const key of ['Enter', ' ']) {
            const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
            await act(async () => chip.dispatchEvent(event))
            expect(event.defaultPrevented).toBe(true)
        }

        expect(writeText).toHaveBeenCalledTimes(2)
        expect(writeText).toHaveBeenNthCalledWith(2, 'DELETE')
    })

    it('shows the whole value, last character included', async () => {
        const chip = await mount('Customer Success (EMEA)')
        expect(chip.textContent).toBe('Customer Success (EMEA)')
    })

    it('hands the focus to the paste target, its text selected, after a click or a key', async () => {
        const field = document.createElement('input')
        field.value = 'Launchs'
        document.body.appendChild(field)
        const pasteTarget = createRef<HTMLInputElement>()
        pasteTarget.current = field

        const chip = await mount('Launchs Rerun', pasteTarget)
        await act(async () => chip.click())
        expect(document.activeElement).toBe(field)
        expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])

        chip.focus()
        await act(async () => chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
        expect(document.activeElement).toBe(field)
        field.remove()
    })

    it('ignores other keys', async () => {
        const chip = await mount('DELETE')
        await act(async () => chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })))
        expect(writeText).not.toHaveBeenCalled()
    })
})
