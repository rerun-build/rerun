import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { Hono } from 'hono'
import { getAgent } from '../../agents/registry.js'
import { listCheckins } from '../../checkins/log.js'
import { nextPulseAt } from '../../checkins/pulse.js'
import { startCheckin } from '../../checkins/run.js'
import { checkinsEnabled } from '../../config/env.js'
import { notFound } from '../../lib/errors.js'
import { nextRunAt } from '../../schedules/cron.js'
import { listSchedules } from '../../schedules/loader.js'

// The Chief of Staff's check-ins. Only the foreman has any.
export const checkinRoutes = new Hono()

checkinRoutes.post('/run', async c => {
    if (c.req.param('id') !== FOREMAN_AGENT_ID) throw notFound('Check-ins')
    return c.json(await startCheckin('manual'), 202)
})

// The earliest of its next pulse and its own promises; nothing while its check-ins are off.
async function nextCheckinAt(enabled: boolean, now: Date): Promise<string | null> {
    if (!enabled) return null
    const promises = (await listSchedules(FOREMAN_AGENT_ID)).filter(schedule => schedule.checkIn && schedule.enabled).map(schedule => nextRunAt(schedule, now))
    const pulse = (await nextPulseAt(now))?.toISOString()
    const candidates = [...promises, pulse].filter((at): at is string => typeof at === 'string')
    return candidates.sort()[0] ?? null
}

checkinRoutes.get('/', async c => {
    if (c.req.param('id') !== FOREMAN_AGENT_ID) throw notFound('Check-ins')
    const foreman = await getAgent(FOREMAN_AGENT_ID)
    const available = checkinsEnabled()
    const [checkins, nextAt] = await Promise.all([listCheckins(), nextCheckinAt(available && foreman.config.proactive.enabled, new Date())])
    return c.json({ proactive: foreman.config.proactive, available, checkins, nextAt })
})
