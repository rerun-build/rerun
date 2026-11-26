// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { boardKeyAllowed, boardShortcutFor, orderBoxesForShortcuts, shortcutRepeats } from './board-shortcuts'

const box = (id: string, col: number, row: number, size = 8) => ({ id, col_start: col, row_start: row, col_end: col + size - 1, row_end: row + size - 1 })

describe('orderBoxesForShortcuts', () => {
    it('reads the board top to bottom, then left to right', () => {
        const ids = orderBoxesForShortcuts([box('bottom', 9, 9), box('right', 9, 0), box('top', 0, 0), box('left', 0, 9)]).map(b => b.id)
        expect(ids).toEqual(['top', 'left', 'right', 'bottom'])
    })

    it('reads a Box drawn from any corner by its north corner', () => {
        const reversed = { id: 'reversed', col_start: 7, col_end: 0, row_start: 7, row_end: 0 }
        expect(orderBoxesForShortcuts([box('lower', 1, 1), reversed]).map(b => b.id)).toEqual(['reversed', 'lower'])
    })

    it('keeps nine Boxes at most', () => {
        const boxes = Array.from({ length: 12 }, (_, i) => box(`b${i}`, i * 9, 0))
        const ordered = orderBoxesForShortcuts(boxes)
        expect(ordered).toHaveLength(9)
        expect(ordered.at(-1)?.id).toBe('b8')
    })
})

describe('boardShortcutFor', () => {
    it('zooms with + and = and the keypad plus', () => {
        expect(boardShortcutFor({ key: '+', code: 'Equal' })).toEqual({ kind: 'zoomIn' })
        expect(boardShortcutFor({ key: '=', code: 'Equal' })).toEqual({ kind: 'zoomIn' })
        expect(boardShortcutFor({ key: '+', code: 'NumpadAdd' })).toEqual({ kind: 'zoomIn' })
    })

    it('zooms out with - and the keypad minus', () => {
        expect(boardShortcutFor({ key: '-', code: 'Minus' })).toEqual({ kind: 'zoomOut' })
        expect(boardShortcutFor({ key: '-', code: 'NumpadSubtract' })).toEqual({ kind: 'zoomOut' })
    })

    it('keeps the AZERTY 6 key a zoom out, Shift 6 frames Box 6', () => {
        expect(boardShortcutFor({ key: '-', code: 'Digit6' })).toEqual({ kind: 'zoomOut' })
        expect(boardShortcutFor({ key: '6', code: 'Digit6' })).toEqual({ kind: 'fitBox', index: 5 })
    })

    it('reads the digit typed', () => {
        expect(boardShortcutFor({ key: '3', code: 'Digit3' })).toEqual({ kind: 'fitBox', index: 2 })
        expect(boardShortcutFor({ key: '9', code: 'Numpad9' })).toEqual({ kind: 'fitBox', index: 8 })
    })

    it('reads the key of the top row when the layout types something else there', () => {
        expect(boardShortcutFor({ key: '&', code: 'Digit1' })).toEqual({ kind: 'fitBox', index: 0 })
        expect(boardShortcutFor({ key: '"', code: 'Digit3' })).toEqual({ kind: 'fitBox', index: 2 })
        expect(boardShortcutFor({ key: '_', code: 'Digit8' })).toEqual({ kind: 'fitBox', index: 7 })
        expect(boardShortcutFor({ key: 'à', code: 'Digit0' })).toEqual({ kind: 'fitAll' })
    })

    it('fits the whole board with 0', () => {
        expect(boardShortcutFor({ key: '0', code: 'Digit0' })).toEqual({ kind: 'fitAll' })
    })

    it('ignores every other key', () => {
        expect(boardShortcutFor({ key: 'f', code: 'KeyF' })).toBeNull()
        expect(boardShortcutFor({ key: ' ', code: 'Space' })).toBeNull()
        expect(boardShortcutFor({ key: 'End', code: 'Numpad1' })).toBeNull()
    })

    it('repeats the zoom only', () => {
        expect(shortcutRepeats({ kind: 'zoomIn' })).toBe(true)
        expect(shortcutRepeats({ kind: 'zoomOut' })).toBe(true)
        expect(shortcutRepeats({ kind: 'fitAll' })).toBe(false)
        expect(shortcutRepeats({ kind: 'fitBox', index: 0 })).toBe(false)
    })
})

describe('boardKeyAllowed', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    const keyOn = (target: EventTarget | null, modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, target, ...modifiers })

    it('lets a key on the page through', () => {
        expect(boardKeyAllowed(keyOn(document.body))).toBe(true)
        expect(boardKeyAllowed(keyOn(null))).toBe(true)
    })

    it('leaves ⌘, Ctrl and Alt to the browser', () => {
        expect(boardKeyAllowed(keyOn(document.body, { metaKey: true }))).toBe(false)
        expect(boardKeyAllowed(keyOn(document.body, { ctrlKey: true }))).toBe(false)
        expect(boardKeyAllowed(keyOn(document.body, { altKey: true }))).toBe(false)
    })

    it('never fires while typing', () => {
        document.body.innerHTML = '<input id="a" /><textarea id="b"></textarea><select id="c"></select><div id="d" contenteditable="true"></div>'
        for (const id of ['a', 'b', 'c', 'd']) expect(boardKeyAllowed(keyOn(document.getElementById(id)))).toBe(false)
    })

    it('never fires inside a dialog or a menu', () => {
        document.body.innerHTML = '<div role="dialog"><button id="close"></button></div><div role="menu"><button id="item"></button></div>'
        expect(boardKeyAllowed(keyOn(document.getElementById('close')))).toBe(false)
        expect(boardKeyAllowed(keyOn(document.getElementById('item')))).toBe(false)
    })

    it('leaves the keys to a list that searches its options as you type', () => {
        document.body.innerHTML = '<button id="trigger" role="combobox"></button><div role="listbox"><div id="option" role="option"></div></div>'
        expect(boardKeyAllowed(keyOn(document.getElementById('trigger')))).toBe(false)
        expect(boardKeyAllowed(keyOn(document.getElementById('option')))).toBe(false)
    })
})
