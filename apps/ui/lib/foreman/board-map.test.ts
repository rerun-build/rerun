import { describe, expect, it } from 'vitest'

import { renderBoardMap, type ForemanAgentRow, type ForemanSpaceRow } from './board-map'

describe('renderBoardMap', () => {
    it('offers a Box only to a phase that can create one', () => {
        expect(renderBoardMap([], [], { canCreateBox: true })).toContain('create_boxes')

        const refused = renderBoardMap([], [], { canCreateBox: false })
        expect(refused).not.toContain('create_boxes')
        expect(refused).toContain('Nothing can be created at this stage')
    })

    it('leaves what a coworker is doing to get_team_status, and keeps one switched off visible', () => {
        const box: ForemanSpaceRow = { id: 'box-1', name: 'Sales', col_start: 0, row_start: 0, col_end: 3, row_end: 3 }
        const agent: ForemanAgentRow = { id: 'agent-1', name: 'Ada', handle: 'ada', description: null, space_id: 'box-1', col: 1, row: 1, disabled_at: null }

        expect(renderBoardMap([box], [agent], { canCreateBox: true })).toContain('  - Ada (@ada, id agent-1) col 1, row 1')
        expect(renderBoardMap([box], [{ ...agent, disabled_at: '2026-10-01T00:00:00Z' }], { canCreateBox: true })).toContain('(@ada, id agent-1) switched off, col 1, row 1')
    })

    it('tells a member’s foreman which Boxes they only use, and never hints at the hidden ones', () => {
        const box = { id: 'box-1', name: 'Sales', col_start: 0, row_start: 0, col_end: 3, row_end: 3 }
        expect(renderBoardMap([{ ...box, access: 'use' }], [], { canCreateBox: true })).toContain('they use its coworkers but cannot create, change or delete them')
        expect(renderBoardMap([{ ...box, access: 'manage' }], [], { canCreateBox: true })).not.toContain('cannot create')
        const none = renderBoardMap([], [], { canCreateBox: true, hiddenBoxes: 2 })
        expect(none).toContain('No Box of this workspace is open to the person you are talking to')
        expect(none).not.toContain('Lay the divisions')
    })
})
