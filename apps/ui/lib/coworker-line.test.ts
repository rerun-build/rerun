import { byRecency, coworkerLine, sectionsByBox, withPinned, type CoworkerLineSubject, type CoworkerLineTranslator } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import line from '@rerun/i18n/messages/en/workspaceView.json'

// The English pack, as next-intl would write it: the same copy the list shows.
const t: CoworkerLineTranslator = (key, values = {}) => {
    const template = line.line[key.slice('line.'.length) as keyof typeof line.line]
    return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name as keyof typeof values] ?? '')
}

const coworker = (patch: Partial<CoworkerLineSubject> = {}): CoworkerLineSubject => ({ status: 'idle', paused: false, description: 'Finds leads', latest: { title: 'Q4 prospects', updatedAt: '2026-11-13T10:00:00Z' }, ...patch })

describe('coworkerLine', () => {
    it('says a paused coworker is paused, whatever it was doing', () => {
        expect(coworkerLine(coworker({ paused: true, status: 'error' }), t)).toEqual({ text: 'Paused', tone: 'muted' })
    })

    it('shows what a waiting coworker waits on, in colour', () => {
        expect(coworkerLine(coworker({ status: 'waiting_human' }), t)).toEqual({ text: 'Q4 prospects', tone: 'waiting' })
        expect(coworkerLine(coworker({ status: 'waiting_human', latest: null }), t)).toEqual({ text: 'Waiting for you', tone: 'waiting' })
    })

    it('says something went wrong, in red', () => {
        expect(coworkerLine(coworker({ status: 'error' }), t)).toEqual({ text: 'Something went wrong', tone: 'destructive' })
    })

    it('says what a working coworker works on', () => {
        expect(coworkerLine(coworker({ status: 'working' }), t).text).toBe('Working · Q4 prospects')
        expect(coworkerLine(coworker({ status: 'working', latest: null }), t).text).toBe('Working · Finds leads')
        expect(coworkerLine(coworker({ status: 'working', latest: null, description: null }), t).text).toBe('Working')
    })

    it('falls back from the conversation to the description of a coworker nobody talked to', () => {
        expect(coworkerLine(coworker(), t)).toEqual({ text: 'Q4 prospects', tone: 'muted' })
        expect(coworkerLine(coworker({ latest: null }), t)).toEqual({ text: 'Finds leads', tone: 'muted' })
        expect(coworkerLine(coworker({ latest: { title: '  ', updatedAt: '2026-11-13T10:00:00Z' } }), t).text).toBe('Finds leads')
    })

    it('shows the last thing said, "You:" in front of what the reader wrote', () => {
        const latest = (text: string, mine: boolean) => ({ title: 'Q4 prospects', updatedAt: '2026-11-13T10:00:00Z', lastMessage: { text, mine } })
        expect(coworkerLine(coworker({ latest: latest('Three new leads', false) }), t)).toEqual({ text: 'Three new leads', tone: 'muted' })
        expect(coworkerLine(coworker({ latest: latest('Find me leads', true) }), t)).toEqual({ text: 'You: Find me leads', tone: 'muted' })
        expect(coworkerLine(coworker({ latest: { title: 'Q4 prospects', updatedAt: '2026-11-13T10:00:00Z', lastMessage: null } }), t).text).toBe('Q4 prospects')
    })

    it('keeps the request of a waiting coworker over its last message', () => {
        const latest = { title: 'Approve the renewal', updatedAt: '2026-11-13T10:00:00Z', lastMessage: { text: 'Here is the draft', mine: false } }
        expect(coworkerLine(coworker({ status: 'waiting_human', latest }), t)).toEqual({ text: 'Approve the renewal', tone: 'waiting' })
    })

    it('says a coworker whose machine is off sleeps', () => {
        expect(coworkerLine(coworker({ status: 'offline' }), t).text).toBe('Asleep · Finds leads')
    })
})

describe('byRecency', () => {
    it('puts the most recently active first and those never talked to last', () => {
        const fresh = { id: 'a', latest: { title: '', updatedAt: '2026-11-13T12:00:00Z' } }
        const old = { id: 'b', latest: { title: '', updatedAt: '2026-11-01T12:00:00Z' } }
        const silent = { id: 'c', latest: null }
        expect([silent, old, fresh].sort(byRecency).map(entry => entry.id)).toEqual(['a', 'b', 'c'])
    })
})

describe('sectionsByBox', () => {
    const at = (updatedAt: string | null) => (updatedAt ? { title: '', updatedAt } : null)
    const coworkers = [
        { id: 'scout', spaceId: 'sales', latest: at('2026-11-13T09:00:00Z') },
        { id: 'pulse', spaceId: 'sales', latest: at('2026-11-13T12:00:00Z') },
        { id: 'ledger', spaceId: 'support', latest: null },
    ]

    it('groups by Box in the order the Boxes were made, names an unnamed one, leaves out an empty one', () => {
        const sections = sectionsByBox(coworkers, [{ id: 'support', name: null }, { id: 'empty', name: 'Empty' }, { id: 'sales', name: ' Sales ' }], 'Untitled Box')
        expect(sections.map(section => [section.label, section.members.map(member => member.id)])).toEqual([
            ['Untitled Box', ['ledger']],
            ['Sales', ['pulse', 'scout']],
        ])
    })
})

describe('withPinned', () => {
    const team = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    it('puts the pinned first in their order, skips a pin of someone gone, keeps the rest in theirs', () => {
        expect(withPinned(team, ['c', 'gone', 'a'])).toEqual({ pinned: [{ id: 'c' }, { id: 'a' }], others: [{ id: 'b' }] })
    })

    it('pins an extra like the Chief of Staff without listing it among the others', () => {
        const { pinned, others } = withPinned(team, ['foreman'], { id: 'foreman' })
        expect(pinned).toEqual([{ id: 'foreman' }])
        expect(others).toEqual(team)
    })
})
