import { Hono } from 'hono'
import { z } from 'zod'
import { startForemanWake } from '../../foreman/wake-run.js'

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
