import { Hono } from 'hono'
import { z } from 'zod'
import { startForemanWake } from '../../foreman/wake-run.js'
import { mandatoryWakeAt, readWakeState } from '../../foreman/wake-state.js'

export const foremanWakeRoutes = new Hono()

const wakeNowSchema = z.object({ memberId: z.string().min(1).nullable().optional() })

// "Check in now": an admin asks the Chief of Staff to look at the workspace without waiting. The
// wake is the same as one it starts on its own, read-only, and the hub still decides whether it runs.
foremanWakeRoutes.post('/now', async c => {
    const body = wakeNowSchema.parse(await c.req.json().catch(() => ({})))
    const outcome = await startForemanWake({ reason: 'A member of the workspace asked you to check in now.', memberId: body.memberId })
    if (outcome.status !== 'started') return c.json(outcome, outcome.status === 'deferred' ? 409 : 200)
    const { settled: _settled, ...started } = outcome
    return c.json(started, 202)
})

// What the app shows of it: the next check-in, why, and how the last ones went.
foremanWakeRoutes.get('/', async c => {
    const state = await readWakeState()
    const now = new Date()
    const next = [...state.planned.map(wake => ({ at: wake.at, reason: wake.reason, planned: true })), { at: mandatoryWakeAt(state, now).toISOString(), reason: null, planned: false }].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
    return c.json({ next, planned: state.planned, last: state.last, timezone: state.timezone, log: state.log })
})
