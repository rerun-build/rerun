import { describe, expect, it } from 'vitest'

import { arriveTabs, type SessionTab, type SessionTabsState } from '@/hooks/useSessionTabs'

const general: SessionTab = { uid: 'general:a1', id: 'general-row', title: 'General', kind: 'general' }
const thread = (id: string): SessionTab => ({ uid: `uid-${id}`, id, title: `Old ${id}` })
const draft: SessionTab = { uid: 'uid-draft', id: null, title: 'New conversation' }
const none = () => false

describe('the tabs once the hub has answered', () => {
    const state: SessionTabsState = { tabs: [general, thread('a'), thread('b'), draft], activeIndex: 1 }

    it('take the order and the titles of the hub, each keeping its chat', () => {
        const next = arriveTabs(state, { openIds: ['c', 'b'], activeId: null, resume: null }, [{ id: 'c', title: 'From the phone' }, { id: 'b', title: 'Renamed' }], none)
        expect(next.tabs.map(tab => [tab.id, tab.title])).toEqual([['general-row', 'General'], ['c', 'From the phone'], ['b', 'Renamed'], [null, 'New conversation']])
        expect(next.tabs[2].uid).toBe('uid-b')
        expect(next.activeIndex).toBe(0)
        expect(next.hubRevision).toBe(1)
    })

    it('stay on the conversation on screen, wherever its tab went', () => {
        expect(arriveTabs(state, { openIds: ['b', 'a'], activeId: 'a', resume: null }, [], none).activeIndex).toBe(2)
        expect(arriveTabs({ ...state, activeIndex: 3 }, { openIds: ['a'], activeId: undefined, resume: null }, [], none).activeIndex).toBe(2)
    })

    it('keep a thread the hub has not written down yet', () => {
        expect(arriveTabs(state, { openIds: ['a'], activeId: 'a', resume: null }, [], id => id === 'b').tabs.map(tab => tab.id)).toEqual(['general-row', 'a', 'b', null])
    })
})
