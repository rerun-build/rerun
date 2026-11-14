import type { SkillProposalStatus } from './skill-proposal.js'
import { parseHubOutput } from './tool-output.js'

const PINNABLE: SkillProposalStatus[] = ['proposed', 'failed']
const RELEASED_AT_ONCE: SkillProposalStatus[] = ['accepted']

export const RELEASE_DELAY_MS = 2500

type Pinnable = { id: string; status: SkillProposalStatus }

export function isPinnable(status: SkillProposalStatus): boolean {
    return PINNABLE.includes(status)
}

export function nextPinnedIds(pinned: ReadonlySet<string>, proposals: Iterable<Pinnable>): Set<string> {
    const next = new Set<string>()
    for (const proposal of proposals) {
        if (isPinnable(proposal.status) || (pinned.has(proposal.id) && !RELEASED_AT_ONCE.includes(proposal.status))) next.add(proposal.id)
    }
    return next
}

export function settledPinnedIds(pinned: ReadonlySet<string>, proposals: Iterable<Pinnable>): string[] {
    const settled: string[] = []
    for (const proposal of proposals) {
        if (pinned.has(proposal.id) && !isPinnable(proposal.status)) settled.push(proposal.id)
    }
    return settled
}

export function skillProposalIdOf(output: unknown): string | null {
    const out = parseHubOutput<{ status?: string; proposalId?: string }>(output)
    return out?.status === 'shown' && out.proposalId ? out.proposalId : null
}
