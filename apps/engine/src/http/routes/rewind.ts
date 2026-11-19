import { Hono } from 'hono'
import { rewindAgentReportQuerySchema } from '@moldwright/contracts'
import { agentExists } from '../../agents/loader.js'
import { notFound } from '../../lib/errors.js'
import { readAgentRewind } from '../../rewind/read.js'

export const rewindRoutes = new Hono()

rewindRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    if (!agentExists(agentId)) throw notFound('agent')
    const parsed = rewindAgentReportQuerySchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
    if (!parsed.success || parsed.data.from >= parsed.data.to) return c.json({ error: 'invalid rewind window' }, 400)
    return c.json(await readAgentRewind(agentId, parsed.data.from, parsed.data.to))
})
