import { describe, expect, it } from 'vitest'

import { pinPlanBoxes, pinTemplateBoxes } from './pin-plan-boxes'

const BOARD = ['Product', 'Engineering', 'Marketing', 'Support', 'Sales']

describe('pinPlanBoxes', () => {
    it('lays out every Box the board drew, in its order, whatever the model wrote', () => {
        const pinned = pinPlanBoxes({ title: 'Team', boxes: [{ name: 'Growth' }], items: [{ kind: 'agent', name: 'Writer', role: 'writes', box: 'Marketing' }] }, BOARD)
        expect(pinned.boxes).toEqual(BOARD.map(name => ({ name })))
        expect(pinned.title).toBe('Team')
    })

    it('files each agent under the Box as the board spells it', () => {
        const pinned = pinPlanBoxes({ items: [{ kind: 'agent', name: 'Triage', role: 'answers', box: ' support ' }] }, BOARD)
        expect(pinned.items).toEqual([{ kind: 'agent', name: 'Triage', role: 'answers', box: 'Support' }])
    })

    it('lands an agent filed nowhere, or somewhere unknown, in the first Box', () => {
        const pinned = pinPlanBoxes({ items: [{ kind: 'agent', name: 'A', role: 'a' }, { kind: 'agent', name: 'B', role: 'b', box: 'Finance' }] }, BOARD)
        expect((pinned.items as { box: string }[]).map(item => item.box)).toEqual(['Product', 'Product'])
    })

    it('survives a call with nothing in it', () => {
        expect(pinPlanBoxes(null, BOARD)).toEqual({ boxes: BOARD.map(name => ({ name })), items: [] })
    })
})

describe('pinTemplateBoxes', () => {
    const CARD = { templates: [{ slug: 'buyer-signals', title: 'Buyer signals', why: 'Finds leads' }], allow_custom: true }

    it('lays out every Box the board drew and files the template under the one it named', () => {
        const pinned = pinTemplateBoxes({ ...CARD, box: ' sales ' }, BOARD)
        expect(pinned.boxes).toEqual(BOARD.map(name => ({ name })))
        expect(pinned.box).toBe('Sales')
        expect(pinned.templates).toEqual(CARD.templates)
    })

    it('lands a template filed nowhere, or somewhere unknown, in the first Box', () => {
        expect(pinTemplateBoxes(CARD, BOARD).box).toBe('Product')
        expect(pinTemplateBoxes({ ...CARD, box: 'Finance' }, BOARD).box).toBe('Product')
    })
})
