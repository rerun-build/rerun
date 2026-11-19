import { decideSkillProposalAction, listSkillProposalsAction } from '@/app/api/_actions/skill-proposal.actions'
import { ApiError, apiRoute, deniedStatus } from '@/app/api/v1/_lib/api-route'
import { skillProposalDecideRequestSchema, type SkillProposal } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ params }): Promise<{ proposals: SkillProposal[] }> => ({ proposals: await listSkillProposalsAction(params.id) }))

export const POST = apiRoute({ auth: 'member', body: skillProposalDecideRequestSchema }, async ({ params, body }): Promise<{ proposal: SkillProposal }> => {
    const decided = await decideSkillProposalAction(params.id, body.proposalId, body.decision)
    if (!decided.success || !decided.proposal) throw new ApiError(deniedStatus(decided.denied, 503), decided.error ?? 'Failed to update the proposal')
    return { proposal: decided.proposal }
})
