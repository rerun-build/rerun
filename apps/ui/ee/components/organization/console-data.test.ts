import { describe, expect, it } from 'vitest'

import type { CreditMovement, OrganizationCredit } from '@/ee/services/organization-credit.service'
import type { OrganizationWorkspaceDetail } from '@/ee/services/organization-workspaces.service'

import { consoleMachineOf, mergeCreditHistory } from './console-data'

const history = (seqs: number[], nextBeforeSeq: number | null): OrganizationCredit => ({ balanceMicros: seqs[0] ?? 0, movements: seqs.map(seq => ({ id: String(seq), seq }) as CreditMovement), nextBeforeSeq })
const seqsOf = ({ movements }: OrganizationCredit) => movements.map(movement => movement.seq)

describe('mergeCreditHistory', () => {
    it('is the fresh page while only one was shown', () => {
        expect(mergeCreditHistory(history([5, 4, 3], 3), history([4, 3, 2], 2))).toMatchObject({ balanceMicros: 5, nextBeforeSeq: 2 })
        expect(mergeCreditHistory(history([3, 2, 1], null), history([2, 1], null))).toEqual(history([3, 2, 1], null))
    })

    it('keeps the older pages under it, where they stopped', () => {
        const merged = mergeCreditHistory(history([9, 8, 7], 7), history([8, 7, 6, 5, 4], 4))
        expect(seqsOf(merged)).toEqual([9, 8, 7, 6, 5, 4])
        expect(merged.nextBeforeSeq).toBe(4)
    })

    it('drops older pages the fresh one no longer touches', () => {
        expect(mergeCreditHistory(history([99, 98], 98), history([8, 7, 6], 6))).toEqual(history([99, 98], 98))
        expect(seqsOf(mergeCreditHistory(history([9, 8], 8), history([7, 6], 6)))).toEqual([9, 8, 7, 6])
    })
})

describe('consoleMachineOf', () => {
    const read = (machine: OrganizationWorkspaceDetail['machine'], hardware: OrganizationWorkspaceDetail['hardware']) => consoleMachineOf({ machine, hardware } as OrganizationWorkspaceDetail)

    it('is stopped when its host says so, and only while it should run', () => {
        expect(read('running', { managed: true, running: false, disk: null }).state).toBe('stopped')
        expect(read('running', { managed: true, running: null, disk: null }).state).toBe('running')
        expect(read('archiving', { managed: true, running: false, disk: null }).state).toBe('archiving')
        expect(read('none', null)).toEqual({ state: 'none', disk: null })
    })
})
