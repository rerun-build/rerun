import type { InboxItem } from '@rerun/contracts'

import { badgeLabel, inboxCount, inboxSections } from '@/components/inbox/inbox'

const item = (patch: Partial<InboxItem>): InboxItem => ({ id: 'i1', sessionId: 's1', sessionIds: ['s1'], agentId: 'a1', agentName: 'Scout', status: 'awaiting_question', title: 'Leads', message: null, updatedAt: '2026-10-22T10:00:00Z', count: 1, ...patch })

describe('inbox', () => {
    it('sorts the rows into the web sections, in its order, and leaves out an empty one', () => {
        const sections = inboxSections([item({ id: 'done', status: 'done' }), item({ id: 'ask' }), item({ id: 'broke', status: 'error' }), item({ id: 'wait', status: 'waiting_human' })])
        expect(sections.map(section => [section.key, section.items.map(row => row.id)])).toEqual([
            ['needsYou', ['ask', 'wait']],
            ['errors', ['broke']],
            ['done', ['done']],
        ])
    })

    it('counts every run a row stands for, and caps the badge at 99+', () => {
        expect(inboxCount([item({}), item({ status: 'done', count: 24 })])).toBe(25)
        expect(badgeLabel(7)).toBe('7')
        expect(badgeLabel(120)).toBe('99+')
    })
})
