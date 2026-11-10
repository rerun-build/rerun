import { describe, expect, it } from 'vitest'

import { readPlan } from './plan-card'

// The card is drawn from a raw tool call, so every shape below is one a model really can send.

const names = (plan: ReturnType<typeof readPlan>) => plan.groups.map(group => [group.name, group.items.map(item => item.name)])

describe('readPlan', () => {
    it('reads as an organisation chart, divisions in the order they were written', () => {
        const plan = readPlan({
            title: 'Your company on Rerun',
            boxes: [{ name: 'Marketing', role: 'Everything that brings people in' }, { name: 'Sales' }, { name: 'Finance', role: 'Invoices and reconciliation, later' }],
            items: [
                { kind: 'agent', name: 'Content Writer', role: 'Writes and publishes', box: 'Marketing' },
                { kind: 'agent', name: 'Lead Follow-up', role: 'Answers new leads', box: 'Sales' },
            ],
        })

        expect(plan.title).toBe('Your company on Rerun')
        expect(names(plan)).toEqual([
            ['Marketing', ['Content Writer']],
            ['Sales', ['Lead Follow-up']],
            ['Finance', []],
        ])
    })

    // The board draws every division of the plan, the empty ones included: only the card leaves
    // them out, and it does so itself.
    it('keeps a division that holds no agent yet, with what it is for', () => {
        const plan = readPlan({ title: 'Team', boxes: [{ name: 'Support', role: 'When you have customers to answer' }], items: [{ kind: 'agent', name: 'X', role: 'y', box: 'Nowhere' }] })
        expect(plan.groups[0]).toMatchObject({ name: 'Support', role: 'When you have customers to answer', items: [] })
    })

    it('matches a Box whatever the case the agent named it in', () => {
        const plan = readPlan({ title: 'Team', boxes: [{ name: 'Marketing' }], items: [{ kind: 'agent', name: 'Writer', role: 'writes', box: 'marketing' }] })
        expect(names(plan)).toEqual([['Marketing', ['Writer']]])
    })

    it('still shows an agent filed under a division that was never declared', () => {
        const plan = readPlan({ title: 'Team', boxes: [{ name: 'Marketing' }], items: [{ kind: 'agent', name: 'Bookkeeper', role: 'reconciles', box: 'Finance' }] })
        expect(names(plan)).toEqual([
            ['Marketing', []],
            ['Finance', ['Bookkeeper']],
        ])
    })

    it('gathers the agents filed nowhere under a section of their own, with no heading', () => {
        const plan = readPlan({ title: 'Team', boxes: [{ name: 'Marketing' }], items: [{ kind: 'agent', name: 'Orphan', role: 'does things' }] })
        expect(names(plan)).toEqual([
            ['Marketing', []],
            [null, ['Orphan']],
        ])
    })

    it('falls back to one flat section when no division was sent, as the card used to draw', () => {
        const plan = readPlan({ title: 'Team', items: [{ kind: 'agent', name: 'Writer', role: 'writes' }, { kind: 'template', slug: 'seo-weekly', title: 'Weekly SEO' }] })
        expect(names(plan)).toEqual([[null, ['Writer', 'Weekly SEO']]])
    })

    // An onboarding plan streams its agents before the app writes its Boxes into the call.
    it('groups by the Box each agent names when no division was sent', () => {
        const plan = readPlan({ title: 'Team', items: [{ kind: 'agent', name: 'Writer', role: 'writes', box: 'Marketing' }, { kind: 'agent', name: 'Triage', role: 'answers', box: 'Support' }, { kind: 'agent', name: 'Poster', role: 'posts', box: 'Marketing' }] })
        expect(names(plan)).toEqual([
            ['Marketing', ['Writer', 'Poster']],
            ['Support', ['Triage']],
        ])
    })

    it('names a template by its slug when its title is missing', () => {
        expect(readPlan({ items: [{ kind: 'template', slug: 'seo-weekly' }] }).groups[0].items[0].name).toBe('seo-weekly')
    })

    it('reads what the card says beyond the name: the pain, the day it plays and what it hands over', () => {
        const beats = { trigger: 'New email', working: 'Reading order #4812', delivered: 'Reply drafted' }
        const [item] = readPlan({ items: [{ kind: 'agent', name: 'Concierge', role: 'answers', when: 'When an email comes in', need: ' the same five questions ', beats, gets: ['A', ' ', 'B', 'C', 'D'] }] }).groups[0].items
        expect(item).toMatchObject({ need: 'the same five questions', beats, gets: ['A', 'B', 'C'] })
    })

    // A day still streaming in, or one the model half wrote, is no day at all.
    it('leaves out what the model did not write, or wrote in part', () => {
        const [item] = readPlan({ items: [{ kind: 'agent', name: 'Concierge', role: 'answers', beats: { trigger: 'New email', working: 'Read' }, gets: [] }] }).groups[0].items
        expect(item).toEqual({ key: '0-Concierge', name: 'Concierge', role: 'answers', when: '' })
    })

    it('holds up on anything that is not a plan', () => {
        expect(readPlan(null)).toEqual({ title: '', groups: [] })
        expect(readPlan({ title: 42, boxes: 'Marketing', items: [null, {}, { kind: 'agent' }] })).toEqual({ title: '', groups: [] })
    })
})
