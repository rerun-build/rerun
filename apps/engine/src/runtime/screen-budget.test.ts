import { describe, expect, it } from 'vitest'
import { createScreenBudget, type ScreenBudget } from './screen-budget.js'

const VIEW = 320 * 180
const blank = () => Buffer.alloc(VIEW)

function viewWith(changed: number, from = 0, level = 255): Buffer {
    return blank().fill(level, from, from + changed)
}

function stretch(budget: ScreenBudget, view: (i: number) => Buffer): void {
    for (let i = 0; i < budget.perStretch; i++) {
        expect(budget.take()).toBeNull()
        budget.saw(view(i))
    }
}

const moving = (round = 0) => (i: number) => viewWith(200, (round * 60 + i) * 90)

describe('screen budget', () => {
    it('carries on past a stretch whose screen kept changing, once the run asked for one more', () => {
        const budget = createScreenBudget('claude')
        stretch(budget, moving())
        expect(budget.carriesOn()).toBe(false)
        expect(budget.take()).toBe('carry-on')
        expect(budget.carriesOn()).toBe(true)
        expect(budget.stretch()).toBe(0)
        budget.nextStretch()
        expect(budget.stretch()).toBe(1)
        expect(budget.carriesOn()).toBe(false)
        expect(budget.take()).toBeNull()
    })

    it.each([
        ['one screen', () => blank()],
        ['two screens it goes back and forth between', (i: number) => viewWith(i % 2 ? 5000 : 0)],
        ['a caret that blinks and a pointer that moves', (i: number) => viewWith(25, i * 64)],
        ['a faint flicker', (i: number) => viewWith(VIEW, 0, i % 24)],
    ])('stops a run that only ever saw %s', (_name, view) => {
        const budget = createScreenBudget('codex')
        stretch(budget, view)
        expect(budget.take()).toBe('stuck')
        expect(budget.carriesOn()).toBe(false)
    })

    it('remembers the screens of the stretches before: seeing them again is not going forward', () => {
        const budget = createScreenBudget('claude')
        stretch(budget, moving())
        budget.take()
        budget.nextStretch()
        stretch(budget, moving())
        expect(budget.take()).toBe('stuck')
    })

    it('sees text added bit by bit as a new screen', () => {
        const budget = createScreenBudget('claude')
        stretch(budget, i => viewWith(i * 20))
        expect(budget.take()).toBe('carry-on')
    })

    it('ends a run on a CLI at 600 whatever the screen shows', () => {
        const budget = createScreenBudget('claude')
        for (let round = 0; round < 10; round++) {
            stretch(budget, i => viewWith(200 + round * 100, i * 90, 60 + round * 19))
            if (round < 9) {
                expect(budget.take()).toBe('carry-on')
                budget.nextStretch()
            }
        }
        expect(budget.take()).toBe('spent')
        expect(budget.carriesOn()).toBe(false)
    })

    it('gives every other provider 200 in one go', () => {
        const budget = createScreenBudget('anthropic')
        for (let i = 0; i < 200; i++) expect(budget.take()).toBeNull()
        expect(budget.take()).toBe('spent')
        expect(budget.carriesOn()).toBe(false)
    })
})
