import { Hono } from 'hono'
import { z } from 'zod'
import { getAgent } from '../../agents/registry.js'
import { applySkillProposal } from '../../skills/apply-proposal.js'
import { getSkillProposal, listSessionSkillProposals, toSkillProposal, transitionSkillProposal } from '../../db/repos/skill-proposals.js'
import { notFound } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'

export const skillProposalRoutes = new Hono()

// The model the conversation is set to when the row is clicked. A hub that sends none, or an older
// one, leaves the job on the proposal's own pair and its fallbacks.
const acceptBodySchema = z.object({ connectionId: z.string().min(1).optional(), model: z.string().min(1).optional() })

skillProposalRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    const sessionId = c.req.query('session')
    if (!sessionId) return c.json({ error: 'session is required' }, 400)
    const rows = await listSessionSkillProposals(agentId, sessionId)
    return c.json({ proposals: rows.map(toSkillProposal) })
})

// Accepting answers before the writing is done: the job holds no session claim, opens no run and
// appends no message, so nothing about it reaches the conversation.
skillProposalRoutes.post('/:pid/accept', async c => {
    const agentId = c.req.param('id')!
    const pid = c.req.param('pid')!
    const claimed = await transitionSkillProposal(agentId, pid, ['proposed', 'failed'], 'accepted', { error: null })
    const row = await getSkillProposal(agentId, pid)
    if (!row) throw notFound('proposal')
    if (!claimed) return c.json({ proposal: toSkillProposal(row) }, 200)

    const body = acceptBodySchema.safeParse(await c.req.json().catch(() => ({})))
    const picked = body.success && body.data.model ? body.data : undefined
    const agent = await getAgent(agentId)
    void applySkillProposal(agent, row, picked).catch(err => logger.warn({ err: String(err), agent: agentId, proposal: pid }, 'skill proposal job crashed'))
    return c.json({ proposal: toSkillProposal({ ...row, status: 'accepted' }) }, 202)
})

skillProposalRoutes.post('/:pid/dismiss', async c => {
    const agentId = c.req.param('id')!
    const pid = c.req.param('pid')!
    await transitionSkillProposal(agentId, pid, ['proposed', 'failed'], 'dismissed')
    const row = await getSkillProposal(agentId, pid)
    if (!row) throw notFound('proposal')
    return c.json({ proposal: toSkillProposal(row) })
})
