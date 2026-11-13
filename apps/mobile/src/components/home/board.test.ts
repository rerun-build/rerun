import { byRecency, FOREMAN_AGENT_ID, sectionsByBox, withPinned, type AgentConversationsOverview, type BoardAgent } from '@rerun/contracts'

import { foremanOnBoard, lineOf, minutesSince, moodStatus, moveIn, sectionOf, recentCoworkers, toHomeCoworkers } from '@/components/home/board'

const agent = (patch: Partial<BoardAgent>): BoardAgent => ({ id: 'a1', name: 'Scout', handle: 'scout', description: 'Finds leads', templateId: null, status: 'idle', workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null, ...patch })
const latest = (patch: Partial<NonNullable<AgentConversationsOverview[number]['latest']>> = {}) => ({ id: 'c1', agentId: 'a1', engineSessionId: 'e1', title: 'Q4 prospects', status: 'idle' as const, source: 'dashboard' as const, updatedAt: '2026-10-21T10:00:00Z', originAgentName: null, ...patch })

const one = (patch: Partial<BoardAgent>, overview: AgentConversationsOverview = []) => toHomeCoworkers([agent(patch)], overview)[0]

describe('home board', () => {
    it('joins each coworker to its latest conversation and its pending count', () => {
        const coworker = one({}, [{ agentId: 'a1', latest: latest(), pending: 2 }])
        expect(coworker).toMatchObject({ id: 'a1', latest: { title: 'Q4 prospects' }, pending: 2, paused: false })
        expect(one({}).latest).toBeNull()
    })

    it('puts a coworker waiting for its human or in error under Needs you, a running one under Working', () => {
        expect(sectionOf(one({ status: 'waiting_human' }))).toBe('needs')
        expect(sectionOf(one({ status: 'error' }))).toBe('needs')
        expect(sectionOf(one({ status: 'working' }))).toBe('working')
        expect(sectionOf(one({ status: 'idle' }))).toBe('coworkers')
    })

    it('keeps a paused coworker with the others, asleep, whatever its last status', () => {
        const paused = one({ status: 'error', disabledAt: '2026-10-20T00:00:00Z' })
        expect(sectionOf(paused)).toBe('coworkers')
        expect(moodStatus(paused)).toBe('offline')
        expect(lineOf(paused)).toEqual({ text: 'Paused', tone: 'muted' })
    })

    it('says what the coworker waits on, does, or left off at', () => {
        expect(lineOf(one({ status: 'waiting_human' }, [{ agentId: 'a1', latest: latest(), pending: 1 }]))).toEqual({ text: 'Q4 prospects', tone: 'waiting' })
        expect(lineOf(one({ status: 'working' }))).toEqual({ text: 'Working · Finds leads', tone: 'muted' })
        expect(lineOf(one({ status: 'idle' }, [{ agentId: 'a1', latest: latest(), pending: 0 }]))).toEqual({ text: 'Q4 prospects', tone: 'muted' })
        expect(lineOf(one({ status: 'idle', description: null }))).toEqual({ text: '', tone: 'muted' })
    })

    it('orders the most recently active first, those never talked to last', () => {
        const fresh = one({ id: 'a1' }, [{ agentId: 'a1', latest: latest({ updatedAt: '2026-10-21T12:00:00Z' }), pending: 0 }])
        const old = { ...one({ id: 'a2' }), latest: latest({ updatedAt: '2026-10-01T12:00:00Z' }) }
        const silent = one({ id: 'a3' })
        expect([silent, old, fresh].sort(byRecency).map(coworker => coworker.id)).toEqual(['a1', 'a2', 'a3'])
    })

    it('counts whole minutes since the last activity', () => {
        expect(minutesSince('2026-10-21T10:00:00Z', Date.parse('2026-10-21T10:05:30Z'))).toBe(5)
        expect(minutesSince(null)).toBeNull()
    })
})

describe('home sections', () => {
    const coworkers = toHomeCoworkers(
        [agent({ id: 'scout', status: 'waiting_human', spaceId: 'sales' }), agent({ id: 'pulse', status: 'idle', spaceId: 'sales' }), agent({ id: 'ledger', status: 'error', spaceId: 'support' })],
        [{ agentId: 'pulse', latest: latest({ updatedAt: '2026-10-21T12:00:00Z' }), pending: 0 }]
    )
    const box = (id: string, name: string | null) => ({ id, name, createdAt: null, managed: true })

    it('lists every coworker in one list, the most recently active first', () => {
        expect(recentCoworkers(coworkers).map(coworker => coworker.id)).toEqual(['pulse', 'scout', 'ledger'])
    })

    it('groups by Box in the order the Boxes were made, names an unnamed one like the web, and leaves out an empty one', () => {
        const sections = sectionsByBox(coworkers, [box('support', null), box('empty', 'Empty'), box('sales', 'Sales')], 'Untitled Box')
        expect(sections.map(section => [section.label, section.members.map(member => member.id)])).toEqual([
            ['Untitled Box', ['ledger']],
            ['Sales', ['pulse', 'scout']],
        ])
    })
})

describe('withPinned', () => {
    const team = toHomeCoworkers([agent({ id: 'a', name: 'A' }), agent({ id: 'b', name: 'B' }), agent({ id: 'c', name: 'C' })], [])

    it('puts the pinned coworkers first, in the order they were arranged', () => {
        const { pinned, others } = withPinned(team, ['c', 'a'])
        expect(pinned.map(coworker => coworker.id)).toEqual(['c', 'a'])
        expect(others.map(coworker => coworker.id)).toEqual(['b'])
    })

    it('skips a pin of a coworker deleted since', () => {
        expect(withPinned(team, ['gone', 'b']).pinned.map(coworker => coworker.id)).toEqual(['b'])
    })

    it('places the pinned Foreman among the pins and never in the list', () => {
        const foreman = foremanOnBoard(false)
        const { pinned, others } = withPinned(team, ['b', FOREMAN_AGENT_ID], foreman)
        expect(pinned.map(coworker => coworker.id)).toEqual(['b', FOREMAN_AGENT_ID])
        expect(others.map(coworker => coworker.id)).toEqual(['a', 'c'])
        expect(withPinned(team, [], foreman).others.map(coworker => coworker.id)).toEqual(['a', 'b', 'c'])
    })
})

describe('moveIn', () => {
    it('moves an item down and up the list', () => {
        expect(moveIn(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
        expect(moveIn(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    })
})
