import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { vaultBoxGroups } from './vault-boxes'

const coworker = (id: string, spaceId: string) => ({ id, name: id.toUpperCase(), spaceId })
const box = (id: string, created_at: string, sidebar_order: number | null = null, name: string | null = id) => ({ id, name, created_at, sidebar_order })
const chief = { id: FOREMAN_AGENT_ID, name: 'Chief of Staff', spaceId: '' }
const shape = ({ chief, groups, loose }: ReturnType<typeof vaultBoxGroups>) => ({ chief: chief?.id ?? null, groups: groups.map(group => [group.id, group.coworkers.map(c => c.id)]), loose: loose.map(c => c.id) })

describe('vaultBoxGroups', () => {
    const boxes = [box('b', '2026-11-02'), box('a', '2026-11-01'), box('empty', '2026-11-03')]

    it('keeps the Chief of Staff apart and one group per Box that holds someone, in the order the Boxes were made', () => {
        expect(shape(vaultBoxGroups([chief, coworker('x', 'b'), coworker('y', 'a')], [], boxes))).toEqual({
            chief: FOREMAN_AGENT_ID,
            groups: [
                ['a', ['y']],
                ['b', ['x']],
            ],
            loose: [],
        })
    })

    it('follows the order someone arranged, for the Boxes and for their coworkers', () => {
        const agents = [
            { id: 'x', createdAt: '2026-11-05', sidebarOrder: 2 },
            { id: 'z', createdAt: '2026-11-06', sidebarOrder: 1 },
        ]
        expect(shape(vaultBoxGroups([coworker('x', 'b'), coworker('z', 'b'), coworker('y', 'a')], agents, [box('a', '2026-11-01'), box('b', '2026-11-02', 1)]))).toEqual({
            chief: null,
            groups: [
                ['b', ['z', 'x']],
                ['a', ['y']],
            ],
            loose: [],
        })
    })

    it('lists the coworkers without a group when a single Box holds them all', () => {
        expect(shape(vaultBoxGroups([chief, coworker('x', 'a'), coworker('y', 'a')], [], boxes))).toEqual({ chief: FOREMAN_AGENT_ID, groups: [], loose: ['x', 'y'] })
    })

    it('never drops a coworker whose Box the board does not hold', () => {
        expect(shape(vaultBoxGroups([coworker('x', 'a'), coworker('y', 'gone')], [], boxes))).toEqual({ chief: null, groups: [['a', ['x']]], loose: ['y'] })
    })

    it('lists everyone as before while the board is not loaded', () => {
        expect(shape(vaultBoxGroups([chief, coworker('x', 'a'), coworker('y', 'b')], [], []))).toEqual({ chief: FOREMAN_AGENT_ID, groups: [], loose: ['x', 'y'] })
    })

    it('has nothing to show without coworkers', () => {
        expect(shape(vaultBoxGroups([], [], boxes))).toEqual({ chief: null, groups: [], loose: [] })
    })
})
