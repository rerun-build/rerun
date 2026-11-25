import { describe, expect, it } from 'vitest'

import { opensOnHost, pickHostWorkspace, readWorkspaceId, type HostMembership } from './host-workspace'

const at = (workspaceId: number, organizationId: string | null, joinedAt: string): HostMembership => ({ workspaceId, organizationId, joinedAt })
const MEMBERSHIPS = [at(3, 'nordlys', '2026-11-03'), at(1, null, '2026-11-01'), at(2, 'nordlys', '2026-11-02'), at(4, 'havre', '2026-11-04')]
const NORDLYS = { organizationId: 'nordlys' }
const RERUN = { organizationId: null }

describe('the workspace a host opens on', () => {
    it.each([
        ['the first candidate it opens', NORDLYS, [3], 3],
        ['the next one when the first is another organization’s', NORDLYS, [4, 3], 3],
        ['the next one when the first is one’s own', NORDLYS, [1, null, 2], 2],
        ['the one joined first when none is', NORDLYS, [4, 1], 2],
        ['the one joined first when nothing is asked', NORDLYS, [], 2],
        ['never one they are not in', NORDLYS, [99], 2],
        ['on Rerun’s own address, one no organization runs', RERUN, [3, 2], 1],
        ['nothing when none of theirs is the organization’s', { organizationId: 'elsewhere' }, [1, 2], null],
    ])('%s', (_case, scope, candidates, picked) => {
        expect(pickHostWorkspace(scope, MEMBERSHIPS, candidates)).toBe(picked)
    })

    it('is nothing on Rerun’s address for someone who only has organizations’', () => {
        expect(pickHostWorkspace(RERUN, [at(2, 'nordlys', '1')], [2])).toBeNull()
    })

    it('breaks a tie by the older workspace', () => {
        expect(pickHostWorkspace(NORDLYS, [at(9, 'nordlys', 'x'), at(8, 'nordlys', 'x')], [])).toBe(8)
    })
})

describe('opensOnHost', () => {
    it('opens anything where organizations have no address', () => {
        expect(opensOnHost(null, 'nordlys')).toBe(true)
        expect(opensOnHost(null, null)).toBe(true)
    })

    it('opens an organization’s on its own address alone', () => {
        expect(opensOnHost(NORDLYS, 'nordlys')).toBe(true)
        expect(opensOnHost(NORDLYS, 'havre')).toBe(false)
        expect(opensOnHost(NORDLYS, null)).toBe(false)
        expect(opensOnHost(RERUN, 'nordlys')).toBe(false)
        expect(opensOnHost(RERUN, null)).toBe(true)
    })
})

describe('readWorkspaceId', () => {
    it.each([['12', 12], ['', null], [null, null], [undefined, null], ['-1', null], ['1e3', null], ['1;2', null], ['9'.repeat(20), null]])('%j', (raw, id) => {
        expect(readWorkspaceId(raw)).toBe(id)
    })
})
