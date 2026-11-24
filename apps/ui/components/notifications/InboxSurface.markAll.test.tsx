// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InboxSurface, type InboxEntry } from '@rerun/ui/inbox'

const item: InboxEntry = { id: 's1', agentId: 'a1', agentName: 'Scout', status: 'awaiting_question', title: 'Task', message: null, updatedAt: null }

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

const render = (props: Partial<ComponentProps<typeof InboxSurface>>) =>
    act(() => root.render(createElement(InboxSurface, { items: [item], open: true, onOpenChange: () => {}, onOpenItem: () => {}, onMarkRead: () => {}, showSettings: false, ...props })))
const markAll = () => document.querySelector<HTMLButtonElement>('[aria-label="Mark all as read"]')
const control = createElement('button', { 'data-control': true })

it('marks all as read from its own button when the app brings no control', () => {
    const onMarkAllRead = vi.fn()
    render({ onMarkAllRead })
    act(() => markAll()!.click())
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
})

it('shows the control the app brings in place of its button', () => {
    render({ markAllControl: control })
    expect(markAll()).toBeNull()
    expect(document.querySelector('[data-control]')).not.toBeNull()
})

it('keeps its disabled button on an empty inbox, control or not', () => {
    render({ items: [], markAllControl: control })
    expect(markAll()!.disabled).toBe(true)
    expect(document.querySelector('[data-control]')).toBeNull()
})

it('leaves the card open on an Escape a menu above it already took, and closes it on the next one', () => {
    const onOpenChange = vi.fn()
    render({ onOpenChange, markAllControl: control })
    const escape = () => new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    const taken = escape()
    taken.preventDefault()
    act(() => void document.dispatchEvent(taken))
    expect(onOpenChange).not.toHaveBeenCalled()
    act(() => void document.dispatchEvent(escape()))
    expect(onOpenChange).toHaveBeenCalledWith(false)
})
