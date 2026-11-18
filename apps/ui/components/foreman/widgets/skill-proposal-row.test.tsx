import { isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/chat/SkillProposalBlock', () => ({ SkillProposalBlock: () => null }))

const { skillProposalRow } = await import('./skill-proposal-row')

const proposal = { id: 'p1', status: 'applied', appliedSlug: 'weekly-review' }
const shown = { status: 'shown', proposalId: 'p1' }

function row(output: unknown, pinnedIds: string[] = [], pendingId: string | null = null) {
    const decide = vi.fn()
    const onOpenSkill = vi.fn()
    const node = skillProposalRow(output, { proposals: new Map([['p1', proposal]]) as never, pinnedIds: new Set(pinnedIds), pendingId, decide, onOpenSkill })
    return { node, decide, onOpenSkill }
}

describe('skillProposalRow', () => {
    it("draws a decided proposal where it was raised, as the Chief of Staff's own", () => {
        const { node, decide, onOpenSkill } = row(shown)
        expect(isValidElement(node)).toBe(true)
        expect((node as { props: object }).props).toEqual({ agentId: 'foreman', proposal, pending: false, onDecide: decide, onOpenSkill })
    })

    it('reads the output the engine sends as text, and marks the row being decided', () => {
        const { node } = row(JSON.stringify(shown), [], 'p1')
        expect((node as { props: { pending: boolean } }).props.pending).toBe(true)
    })

    it('leaves the spot empty while the dock above the field holds the row', () => {
        expect(row(shown, ['p1']).node).toBeNull()
    })

    it('draws nothing for a call that only joined a waiting proposal, or one the list does not hold', () => {
        expect(row({ status: 'joined', proposalId: 'p1' }).node).toBeNull()
        expect(row({ status: 'shown', proposalId: 'p9' }).node).toBeNull()
        expect(row(undefined).node).toBeNull()
    })
})
