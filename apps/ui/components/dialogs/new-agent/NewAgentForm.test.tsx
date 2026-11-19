// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_READING } from '@rerun/ui/new-agent'

import { NewAgentForm } from './NewAgentForm'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    act(() => {
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === label)
    if (!button) throw new Error(`no "${label}" button on screen`)
    act(() => button.click())
}

describe('NewAgentForm', () => {
    it('keeps the job written when the user steps back to the look and comes back', () => {
        const read = vi.fn(async () => EMPTY_READING)
        act(() => root.render(createElement(NewAgentForm, { suggestions: [], catalog: null, read, onCreate: () => {}, onBrowseTemplates: () => {} })))

        setValue(container.querySelector('input')!, 'Nova')
        click('Continue')
        click('Continue')
        setValue(container.querySelector('textarea')!, 'Find bakeries in Lyon that need a new website')

        click('Back')
        expect(container.querySelector('textarea')).toBeNull()
        click('Continue')

        expect(container.querySelector('textarea')!.value).toBe('Find bakeries in Lyon that need a new website')
    })
})
