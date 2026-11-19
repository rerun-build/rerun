import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { Hono } from 'hono'
import { startCheckin } from '../../checkins/run.js'
import { notFound } from '../../lib/errors.js'

// The Chief of Staff's check-ins. Only the foreman has any.
export const checkinRoutes = new Hono()

checkinRoutes.post('/run', async c => {
    if (c.req.param('id') !== FOREMAN_AGENT_ID) throw notFound('Check-ins')
    return c.json(await startCheckin('manual'), 202)
})
