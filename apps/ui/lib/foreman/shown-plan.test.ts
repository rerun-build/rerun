import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { lastShownPlan, lastShownStarterPlan, planRevisionAsk, templateCardPlan } from './shown-plan'

const assistant = (...parts: unknown[]) => ({ id: 'a', role: 'assistant', parts }) as unknown as UIMessage
const user = (text: string) => ({ id: 'u', role: 'user', parts: [{ type: 'text', text }] }) as unknown as UIMessage

const plan = (title: string) => ({ type: 'tool-show_plan', toolCallId: title, state: 'input-available', input: { title, boxes: [], items: [] } })

describe('lastShownPlan', () => {
    it('reads the card the conversation is stopped on', () => {
        expect(lastShownPlan([assistant(plan('Your team'))])).toEqual({ title: 'Your team', boxes: [], items: [] })
    })

    it('takes the last organisation, the earlier one staying readable in the stream', () => {
        const messages = [assistant({ ...plan('First draft'), state: 'output-available', output: { answered: true, confirmed: false } }), user('Add a Finance division'), assistant(plan('Second draft'))]

        expect(lastShownPlan(messages)).toMatchObject({ title: 'Second draft' })
    })

    it('holds after the plan has been confirmed', () => {
        const confirmed = assistant({ ...plan('Your team'), state: 'output-available', output: { answered: true, confirmed: true } })

        expect(lastShownPlan([confirmed, assistant({ type: 'text', text: 'Let us get you set up.' })])).toMatchObject({ title: 'Your team' })
    })

    it('waits for the card to be written before drawing it', () => {
        const streaming = assistant({ type: 'tool-show_plan', toolCallId: 'x', state: 'input-streaming', input: { title: 'Reta', boxes: [{ name: 'Mark' }] } })

        expect(lastShownPlan([streaming])).toBeNull()
        expect(lastShownPlan([assistant(plan('Your team')), streaming])).toMatchObject({ title: 'Your team' })
    })

    it('has nothing to draw until a card has gone out', () => {
        expect(lastShownPlan([])).toBeNull()
        expect(lastShownPlan([user('hello'), assistant({ type: 'text', text: 'hi' })])).toBeNull()
    })

    it('only reads the assistant', () => {
        expect(lastShownPlan([{ id: 'u', role: 'user', parts: [plan('Not mine')] } as unknown as UIMessage])).toBeNull()
    })
})

describe('planRevisionAsk', () => {
    const refused = { ...plan('First'), state: 'output-available', output: { answered: true, confirmed: false } }
    const confirmed = { ...plan('Second'), state: 'output-available', output: { answered: true, confirmed: true } }
    const askInput = (answer: string) => ({ type: 'tool-ask_input', toolCallId: 'ask', state: 'output-available', input: { question: 'What would you change?' }, output: { answered: true, answers: [answer] } })

    it('keeps what they answered when asked what to change, word for word', () => {
        expect(planRevisionAsk([assistant(refused, askInput('Creator-style carousels.\nNever an ad.'), confirmed)])).toBe('Creator-style carousels.\nNever an ad.')
    })

    it('keeps what they typed over the card, in the order it was said', () => {
        expect(planRevisionAsk([assistant(refused), user('Make it weekly'), assistant(askInput('On Mondays'), confirmed)])).toBe('Make it weekly\n\nOn Mondays')
    })

    it('leaves out everything said before a card went out, and the kickoff', () => {
        expect(planRevisionAsk([user('[[foreman:start]]'), assistant(askInput('Writing posts')), user('It takes me hours'), assistant(confirmed)])).toBeNull()
    })

    it('has nothing to carry for a card confirmed as it was shown', () => {
        expect(planRevisionAsk([assistant(confirmed)])).toBeNull()
    })
})

describe('templateCardPlan', () => {
    const templates = [{ slug: 'buyer-signals', title: 'Buyer signals' }]

    it('keeps every Box the card was laid out with, the template in the one it named', () => {
        const plan = templateCardPlan({ templates, box: 'Sales', boxes: [{ name: 'Product' }, { name: 'Sales' }, { name: 'Support' }] })
        expect(plan).toEqual({ items: [{ kind: 'template', slug: 'buyer-signals', title: 'Buyer signals', box: 'Sales' }], boxes: [{ name: 'Product' }, { name: 'Sales' }, { name: 'Support' }] })
    })

    it('falls back to the one Box a card without them named', () => {
        expect(templateCardPlan({ templates, box: 'Sales' })?.boxes).toEqual([{ name: 'Sales' }])
    })
})

describe('lastShownStarterPlan', () => {
    const PACK = {
        cards: ['a', 'b'].map(slug => ({ slug, promise: `Promise ${slug}`, line: '', title: slug, agent: `Agent ${slug}`, image: null, connectors: [] })),
        box: 'Sales',
        boxes: [{ name: 'Sales' }, { name: 'Ops' }],
    }
    const packMessage = (state: string, output?: unknown) => ({ id: 'a', role: 'assistant', parts: [{ type: 'tool-show_starter_pack', toolCallId: 'p', state, input: PACK, output }] }) as UIMessage

    it('draws the coworkers picked off the pack', () => {
        expect(lastShownStarterPlan([packMessage('output-available', { answered: true, chosen: ['b'] })])).toEqual({ items: [{ kind: 'template', slug: 'b', title: 'Agent b', box: 'Sales' }], boxes: PACK.boxes })
    })

    it('draws nothing while the cards wait, or once they were turned into a line of their own', () => {
        expect(lastShownStarterPlan([packMessage('input-available')])).toBeNull()
        expect(lastShownStarterPlan([packMessage('output-available', { answered: true, custom: 'Chase invoices' })])).toBeNull()
    })
})
