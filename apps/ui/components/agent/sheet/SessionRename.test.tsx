// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatRowRenameField, TabRenameField, useSessionRename } from './SessionRename'

// The field saves on Enter and on a click elsewhere, and its unmount fires a blur in Chrome: every
// way out of it must reach the server once at most, and a save that failed must take another try.

type Field = typeof ChatRowRenameField

function Harness({ field, onRename }: { field: Field; onRename: (id: string, title: string) => Promise<boolean> }) {
    const rename = useSessionRename(onRename)
    const renaming = rename.rename
    if (!renaming) return createElement('button', { type: 'button', onClick: () => rename.start('session-1') }, 'start')
    return createElement(field, { title: 'Quarterly review', status: renaming.status, focus: renaming.focus, onSubmit: (title: string) => void rename.submit('session-1', title), onCancel: rename.cancel })
}

let root: Root | null = null
let container: HTMLElement | null = null

async function settle() {
    for (let i = 0; i < 3; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

async function open(onRename: (id: string, title: string) => Promise<boolean>, field: Field = ChatRowRenameField) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(Harness, { field, onRename })))
    await act(async () => container!.querySelector('button')!.click())
    await settle()
}

const input = () => container!.querySelector('input')

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

function type(value: string) {
    act(() => {
        setValue.call(input(), value)
        input()!.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

const key = (name: string) => new KeyboardEvent('keydown', { key: name, bubbles: true })
const blur = () => new FocusEvent('focusout', { bubbles: true })

async function fire(...events: Event[]) {
    const field = input()!
    await act(async () => events.forEach(event => field.dispatchEvent(event)))
    await settle()
}

function deferred() {
    let resolve!: (renamed: boolean) => void
    const promise = new Promise<boolean>(done => (resolve = done))
    return { promise, resolve }
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
})

describe('renaming a conversation in place', () => {
    it('opens on the current title, focused and selected', async () => {
        await open(vi.fn())

        expect(input()!.value).toBe('Quarterly review')
        expect(document.activeElement).toBe(input())
        expect(input()!.getAttribute('aria-label')).toBe('Conversation name')
        expect(input()!.maxLength).toBe(80)
    })

    it('saves the trimmed title on Enter, waits for the answer, then closes', async () => {
        const save = deferred()
        const onRename = vi.fn(() => save.promise)
        await open(onRename)

        type('  Pipeline, week 46  ')
        await fire(key('Enter'))

        expect(onRename).toHaveBeenCalledWith('session-1', 'Pipeline, week 46')
        expect(input()!.readOnly).toBe(true)
        expect(input()!.disabled).toBe(false)
        expect(container!.querySelector('[role="status"]')).not.toBeNull()

        await act(async () => save.resolve(true))
        await settle()
        expect(input()).toBeNull()
    })

    it('saves on a click elsewhere', async () => {
        const onRename = vi.fn(async () => true)
        await open(onRename)

        type('Pipeline')
        await fire(blur())

        expect(onRename).toHaveBeenCalledWith('session-1', 'Pipeline')
        expect(input()).toBeNull()
    })

    it('cancels on Escape, and the blur of the closing field saves nothing', async () => {
        const onRename = vi.fn(async () => true)
        await open(onRename)

        type('Pipeline')
        await fire(key('Escape'), blur())

        expect(onRename).not.toHaveBeenCalled()
        expect(input()).toBeNull()
    })

    it('sends one save for an Enter followed by the blur of the closing field', async () => {
        const onRename = vi.fn(async () => true)
        await open(onRename)

        type('Pipeline')
        await fire(key('Enter'), blur())

        expect(onRename).toHaveBeenCalledTimes(1)
    })

    it.each([['a blank title', '   '], ['the same title', ' Quarterly review ']])('closes without saving %s', async (_case, typed) => {
        const onRename = vi.fn(async () => true)
        await open(onRename)

        type(typed)
        await fire(key('Enter'))

        expect(onRename).not.toHaveBeenCalled()
        expect(input()).toBeNull()
    })

    it('stays open on what was typed when the save fails, and Enter tries again', async () => {
        const onRename = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        await open(onRename)

        type('Pipeline')
        await fire(key('Enter'))

        expect(input()!.value).toBe('Pipeline')
        expect(input()!.readOnly).toBe(false)
        expect(input()!.getAttribute('aria-invalid')).toBe('true')
        expect(container!.querySelector('[role="alert"]')?.textContent).toBe("Couldn't rename. Try again.")

        await fire(key('Enter'))

        expect(onRename).toHaveBeenCalledTimes(2)
        expect(input()).toBeNull()
    })

    it('treats a save that throws as a failed one', async () => {
        await open(vi.fn().mockRejectedValue(new Error('offline')))

        type('Pipeline')
        await fire(key('Enter'))

        expect(input()!.getAttribute('aria-invalid')).toBe('true')
    })

    it('keeps Escape working after a failed save', async () => {
        await open(vi.fn().mockResolvedValue(false))

        type('Pipeline')
        await fire(key('Enter'))
        await fire(key('Escape'))

        expect(input()).toBeNull()
    })

    it('behaves the same in a tab', async () => {
        const onRename = vi.fn(async () => true)
        await open(onRename, TabRenameField)

        type('Pipeline')
        await fire(key('Enter'))

        expect(onRename).toHaveBeenCalledWith('session-1', 'Pipeline')
        expect(input()).toBeNull()
    })
})
