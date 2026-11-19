import type { HomeCoworker } from '@/components/home/board'
import { translatorFor } from '@/i18n/translator'

import { crewWidgetPropsOf } from './crew-props'

const NOW = Date.parse('2026-11-19T12:00:00Z')

function coworker(id: string, status: HomeCoworker['status'], title: string, updatedAt: string, patch: Partial<HomeCoworker> = {}): HomeCoworker {
    return { id, name: id[0].toUpperCase() + id.slice(1), handle: null, description: null, status, paused: false, spaceId: 'box', latest: { id: `conv-${id}`, title, updatedAt } as HomeCoworker['latest'], pending: 0, generalSessionId: `general-${id}`, ...patch }
}

const t = translatorFor('mobileHome')

describe('crewWidgetPropsOf', () => {
    it('puts whoever waits first, then whoever stopped, then the longest at work, three at most', () => {
        const props = crewWidgetPropsOf(
            [
                coworker('scout', 'working', 'Lyon agencies', '2026-11-19T11:47:00Z'),
                coworker('writer', 'working', 'Newsletter #47', '2026-11-19T11:56:00Z'),
                coworker('closer', 'waiting_human', 'Approve 12 emails', '2026-11-19T11:59:00Z'),
                coworker('ledger', 'idle', 'October report', '2026-11-19T10:00:00Z'),
                coworker('pulse', 'working', 'Weekly digest', '2026-11-19T11:30:00Z', { paused: true }),
            ],
            t,
            'file:///group/widgets',
            NOW
        )
        expect(props.members.map(member => [member.name, member.state, member.badge])).toEqual([
            ['Closer', 'waiting', 'You'],
            ['Scout', 'working', '13m'],
            ['Writer', 'working', '4m'],
        ])
        expect(props.headline).toBe('1 needs you · 2 at work')
        expect(props.asksLine).toBe('Closer asks')
        expect(props.othersLine).toBe('+2 at work')
        expect(props.count).toBe(2)
    })

    it('opens the conversation each coworker waits or works in, and points at its face for its state', () => {
        const [member] = crewWidgetPropsOf([coworker('closer', 'waiting_human', 'Approve 12 emails', '2026-11-19T11:59:00Z')], t, 'file:///group/widgets', NOW).members
        expect(member.url).toBe('rerun://chat/conv-closer?to=closer')
        expect(member.face).toBe('file:///group/widgets/buddy-closer-waiting.png')
    })

    it('says all is done when nobody works nor waits, and draws no face without the shared folder', () => {
        const props = crewWidgetPropsOf([coworker('ledger', 'idle', 'October report', '2026-11-19T10:00:00Z')], t, null, NOW)
        expect(props).toMatchObject({ headline: 'All done', count: 0, countCaption: 'all done', members: [] })
        expect(crewWidgetPropsOf([coworker('scout', 'working', 'Lyon agencies', '2026-11-19T11:47:00Z')], t, null, NOW).members[0].face).toBe('')
    })

    it('counts two coworkers waiting in the plural', () => {
        const props = crewWidgetPropsOf([coworker('closer', 'waiting_human', 'A', '2026-11-19T11:59:00Z'), coworker('scout', 'waiting_human', 'B', '2026-11-19T11:58:00Z')], t, null, NOW)
        expect(props.headline).toBe('2 need you')
    })
})
