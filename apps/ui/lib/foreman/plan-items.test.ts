import { describe, expect, it } from 'vitest'

import { MAX_PLAN_BOXES, readPlanBoxes, readPlanItems } from './plan-items'

const agent = { kind: 'agent', name: 'Scout', role: 'research', box: 'Marketing' }

describe('readPlanItems', () => {
    it('reads the agents of a bespoke plan', () => {
        expect(readPlanItems([agent], ['agent'])).toEqual([{ kind: 'agent', name: 'Scout', role: 'research', box: 'Marketing' }])
    })

    it('carries the pain an agent goes after, and drops an empty one', () => {
        expect(readPlanItems([{ ...agent, need: " Don't know where users hang out " }], ['agent'])).toEqual([{ kind: 'agent', name: 'Scout', role: 'research', need: "Don't know where users hang out", box: 'Marketing' }])
        expect(readPlanItems([{ ...agent, need: '  ' }], ['agent'])).toEqual([{ kind: 'agent', name: 'Scout', role: 'research', box: 'Marketing' }])
    })

    it('carries what the card promised the agent hands over: three lines at most, and the last beat only when all three are there', () => {
        const beats = { trigger: 'Monday', working: 'Checking sites', delivered: 'Qualified companies' }
        expect(readPlanItems([{ ...agent, gets: [' One ', '', 'Two', 'Three', 'Four'], beats }], ['agent'])).toEqual([{ kind: 'agent', name: 'Scout', role: 'research', gets: ['One', 'Two', 'Three'], delivered: 'Qualified companies', box: 'Marketing' }])
        expect(readPlanItems([{ ...agent, gets: [], beats: { ...beats, working: ' ' } }], ['agent'])).toEqual([{ kind: 'agent', name: 'Scout', role: 'research', box: 'Marketing' }])
    })

    it('refuses a ready-made item when nothing brought one into the conversation', () => {
        expect(() => readPlanItems([{ kind: 'template', slug: 'seo-newsroom' }], ['agent'])).toThrow(/kind "template" is not available/)
        expect(() => readPlanItems([{ kind: 'share', token: 'abc' }], ['agent'])).toThrow(/kind "share" is not available/)
    })

    it('takes the one the user arrived on', () => {
        expect(readPlanItems([{ kind: 'template', slug: 'seo-newsroom', title: 'SEO Newsroom' }], ['agent', 'template'])).toEqual([{ kind: 'template', slug: 'seo-newsroom', title: 'SEO Newsroom', box: undefined }])
        expect(readPlanItems([{ kind: 'share', token: 'abc' }], ['agent', 'share'])).toEqual([{ kind: 'share', token: 'abc', name: undefined, box: undefined }])
    })

    it('refuses an agent written beside the one the user arrived on', () => {
        expect(() => readPlanItems([{ kind: 'template', slug: 'seo-newsroom' }, agent], ['agent', 'template'])).toThrow(/holds nothing else/)
        expect(() => readPlanItems([agent, { kind: 'share', token: 'abc' }], ['agent', 'share'])).toThrow(/holds nothing else/)
    })

    it('refuses a second agent on a first plan', () => {
        expect(() => readPlanItems([agent, { ...agent, name: 'Closer' }], ['agent'])).toThrow(/holds one coworker, and this one has 2/)
    })

    it('takes up to three coworkers picked off the starter pack, and refuses a fourth', () => {
        const pick = (slug: string) => ({ kind: 'template', slug, title: slug, focus: `Focus ${slug}`, box: 'Sales' })
        expect(readPlanItems([pick('a'), pick('b'), pick('c')], ['template'])).toEqual([
            { kind: 'template', slug: 'a', title: 'a', focus: 'Focus a', box: 'Sales' },
            { kind: 'template', slug: 'b', title: 'b', focus: 'Focus b', box: 'Sales' },
            { kind: 'template', slug: 'c', title: 'c', focus: 'Focus c', box: 'Sales' },
        ])
        expect(() => readPlanItems([pick('a'), pick('b'), pick('c'), pick('d')], ['template'])).toThrow(/3 ready-made coworkers at most/)
    })

    it('still lets them turn the link down for an agent designed for them', () => {
        expect(readPlanItems([agent], ['agent', 'template'])).toEqual([{ kind: 'agent', name: 'Scout', role: 'research', box: 'Marketing' }])
    })

    it('answers on what the argument really is', () => {
        expect(readPlanItems(undefined, ['agent'])).toEqual([])
        expect(() => readPlanItems([{ kind: 'agent', name: 'Scout' }], ['agent'])).toThrow(/items\[\]\.role/)
    })
})

describe('readPlanBoxes', () => {
    it('keeps the divisions that carry a name, in the order they were written', () => {
        expect(readPlanBoxes([{ name: ' Marketing ', role: 'the site and the content' }, { role: 'nameless' }, { name: 'Sales' }])).toEqual([{ name: 'Marketing', role: 'the site and the content' }, { name: 'Sales', role: undefined }])
    })

    it('reads a plan written before divisions existed', () => {
        expect(readPlanBoxes(undefined)).toEqual([])
    })

    it(`refuses a plan past ${MAX_PLAN_BOXES} Boxes`, () => {
        const boxes = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `Division ${index}` }))
        expect(readPlanBoxes(boxes(MAX_PLAN_BOXES))).toHaveLength(MAX_PLAN_BOXES)
        expect(() => readPlanBoxes(boxes(MAX_PLAN_BOXES + 1))).toThrow(/at most/)
    })
})
