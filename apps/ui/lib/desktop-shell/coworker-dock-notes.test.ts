import { describe, expect, it } from 'vitest'

import type { InboxItem } from '@/hooks/useInboxItems'

import { dockNotesOf, freshNotes, stackBubbleTops } from './coworker-dock-notes'

const question: InboxItem = { id: 'session-1', agentId: 'closer', agentName: 'Closer', engineSessionId: 'engine-1', status: 'awaiting_question', title: 'Pipeline follow-ups', message: 'How should the follow-ups sound?', updatedAt: '2026-11-20T10:00:00.000Z' }
const finished: InboxItem = { id: 'done:weekly', agentId: 'writer', agentName: 'Blog writer', engineSessionId: null, status: 'done', title: 'Weekly blog post', message: null, updatedAt: '2026-11-20T09:00:00.000Z', count: 3, sessionIds: ['run-1', 'run-2', 'run-3'], latestSessionId: 'run-3' }

describe('dockNotesOf', () => {
    it('gives a waiting conversation its own session, and a finished task its last run', () => {
        expect(dockNotesOf([question, finished])).toEqual([
            { id: 'session-1', agentId: 'closer', status: 'awaiting_question', title: 'Pipeline follow-ups', text: 'How should the follow-ups sound?', updatedAt: '2026-11-20T10:00:00.000Z', sessionId: 'session-1', engineSessionId: 'engine-1' },
            { id: 'done:weekly', agentId: 'writer', status: 'done', title: 'Weekly blog post', text: null, updatedAt: '2026-11-20T09:00:00.000Z', sessionId: 'run-3', engineSessionId: null, count: 3 },
        ])
    })
})

describe('freshNotes', () => {
    const since = Date.parse('2026-11-20T08:00:00.000Z')
    const [asks, done] = dockNotesOf([question, finished])

    it('gives what a coworker said once, newest first, and never what predates the dock', () => {
        const seen = new Set<string>()
        const old = { ...asks, id: 'old', updatedAt: '2026-11-20T07:00:00.000Z' }
        expect(freshNotes([done, asks, old], seen, since).map(note => note.id)).toEqual(['session-1', 'done:weekly'])
        expect(freshNotes([done, asks, old], seen, since)).toEqual([])
    })

    it('does not give again what the main window held before it reloaded', () => {
        const seen = new Set<string>()
        freshNotes([asks, done], seen, since)
        expect(freshNotes([], seen, since)).toEqual([])
        expect(freshNotes([asks, done], seen, since)).toEqual([])
        const later = { ...asks, updatedAt: '2026-11-20T11:00:00.000Z' }
        expect(freshNotes([later, done], seen, since)).toEqual([later])
    })
})

describe('stackBubbleTops', () => {
    it('keeps a bubble level with its buddy when it has the room', () => {
        expect(stackBubbleTops([{ id: 'a', anchor: 300 }], 88, 60, 900)).toEqual(new Map([['a', 300]]))
    })

    it('pushes the bubble of a neighbour below the one above it', () => {
        const tops = stackBubbleTops([{ id: 'b', anchor: 344 }, { id: 'a', anchor: 300 }], 88, 60, 900)
        expect(tops.get('a')).toBe(300)
        expect(tops.get('b')).toBe(388)
    })

    it('moves the whole pile up when it runs past the bottom, never past the top', () => {
        const tops = stackBubbleTops([{ id: 'a', anchor: 850 }, { id: 'b', anchor: 860 }], 88, 60, 900)
        expect(tops.get('b')).toBe(900)
        expect(tops.get('a')).toBe(812)
        const cramped = stackBubbleTops([{ id: 'a', anchor: 70 }, { id: 'b', anchor: 80 }], 88, 60, 100)
        expect(cramped.get('a')).toBe(60)
    })
})
