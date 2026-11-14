import { Hono } from 'hono'
import { getAgent } from '../../agents/registry.js'
import { applySkillProposal } from '../../skills/apply-proposal.js'
import { getSkillProposal, listSessionSkillProposals, toSkillProposal, transitionSkillProposal } from '../../db/repos/skill-proposals.js'
import { notFound } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'

export const skillProposalRoutes = new Hono()

skillProposalRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    const sessionId = c.req.query('session')
    if (!sessionId) return c.json({ error: 'session is required' }, 400)
    const rows = await listSessionSkillProposals(agentId, sessionId)
    return c.json({ proposals: rows.map(toSkillProposal) })
})

skillProposalRoutes.post('/:pid/accept', async c => {
    const agentId = c.req.param('id')!
    const pid = c.req.param('pid')!
    const claimed = await transitionSkillProposal(agentId, pid, ['proposed', 'failed'], 'accepted', { error: null })
    const row = await getSkillProposal(agentId, pid)
    if (!row) throw notFound('proposal')
    if (!claimed) return c.json({ proposal: toSkillProposal(row) }, 200)

    const agent = await getAgent(agentId)
    void applySkillProposal(agent, row).catch(err => logger.warn({ err: String(err), agent: agentId, proposal: pid }, 'skill proposal job crashed'))
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
