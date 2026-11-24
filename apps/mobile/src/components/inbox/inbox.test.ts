import type { InboxItem } from '@rerun/contracts'

import { badgeLabel, inboxCount, inboxSections, splitInbox } from '@/components/inbox/inbox'

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

    it('keeps every request out of what « Mark as read » takes off the list', () => {
        const requests = [item({ id: 'ask' }), item({ id: 'approve', status: 'awaiting_approval', sessionIds: ['s2'] }), item({ id: 'connect', status: 'awaiting_connector', sessionIds: ['s3'] }), item({ id: 'wait', status: 'waiting_human', sessionIds: ['s4'] })]
        const informative = [item({ id: 'ack', status: 'awaiting_ack', sessionIds: ['s5'] }), item({ id: 'broke', status: 'error', sessionIds: ['s6'] }), item({ id: 'done', status: 'done', sessionIds: ['s7', 's8'] })]
        expect(splitInbox([...requests, ...informative])).toEqual({ requests, informative })
    })

    it('leaves a finished run whose conversation now waits on a request', () => {
        const ask = item({ id: 'ask', sessionIds: ['s1'] })
        const done = item({ id: 'done', status: 'done', sessionIds: ['s9', 's1'] })
        expect(splitInbox([ask, done]).informative).toEqual([])
    })

    it('counts every run a row stands for, and caps the badge at 99+', () => {
        expect(inboxCount([item({}), item({ status: 'done', count: 24 })])).toBe(25)
        expect(badgeLabel(7)).toBe('7')
        expect(badgeLabel(120)).toBe('99+')
    })
})
