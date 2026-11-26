// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { keepsMessageSelection } from './message-actions'

function mount(html: string) {
    document.body.innerHTML = html
    const chat = document.querySelector<HTMLElement>('[data-chat]')
    const at = (selector: string) => document.querySelector(selector)!
    return { chat, at }
}

const CHAT = `
    <div data-chat>
        <div data-zone="thread">
            <div data-message-id="m1"><p id="m1-text">Find agencies</p></div>
            <div data-message-id="m2" data-selected><p id="m2-text">Found 20</p><div data-message-actions><button id="copy">Copy</button></div></div>
        </div>
        <textarea id="composer"></textarea>
    </div>`

afterEach(() => {
    document.body.innerHTML = ''
})

describe('keepsMessageSelection', () => {
    it('lets go on the empty thread, the composer and anywhere else on the page', () => {
        const { chat, at } = mount(`<aside id="board">Board</aside>${CHAT}`)
        expect(keepsMessageSelection(at('[data-zone="thread"]'), chat)).toBe(false)
        expect(keepsMessageSelection(at('#composer'), chat)).toBe(false)
        expect(keepsMessageSelection(at('#board'), chat)).toBe(false)
    })

    it('keeps it on its bar and on a message of the chat, whose own click moves the selection', () => {
        const { chat, at } = mount(CHAT)
        expect(keepsMessageSelection(at('#copy'), chat)).toBe(true)
        expect(keepsMessageSelection(at('#m1-text'), chat)).toBe(true)
    })

    it('lets go on a message of another chat', () => {
        const { chat, at } = mount(`${CHAT}<div data-other><div data-message-id="o1"><p id="other">Hi</p></div></div>`)
        expect(keepsMessageSelection(at('#other'), chat)).toBe(false)
    })

    it('keeps it while a menu is open, in a popover and in the confirmation of a deletion', () => {
        const { chat, at } = mount(`${CHAT}<div data-radix-popper-content-wrapper><span id="pop">x</span></div><div role="alertdialog"><button id="cancel">Cancel</button></div>`)
        expect(keepsMessageSelection(at('#pop'), chat)).toBe(true)
        expect(keepsMessageSelection(at('#cancel'), chat)).toBe(true)
        const open = mount(`${CHAT}<div role="menu"><div role="menuitem">Copy</div></div>`)
        expect(keepsMessageSelection(open.at('#composer'), open.chat)).toBe(true)
    })

    it('lets go inside the sheet that holds the chat', () => {
        const { chat, at } = mount(`<div role="dialog"><header id="sheet-header">Léa</header>${CHAT}</div>`)
        expect(keepsMessageSelection(at('#sheet-header'), chat)).toBe(false)
        expect(keepsMessageSelection(at('#composer'), chat)).toBe(false)
    })
})
