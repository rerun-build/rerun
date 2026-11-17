import { Hono } from 'hono'
import { remoteComputerRuleSchema, remoteComputerUpsertSchema } from '@rerun/contracts'
import { remoteComputersEnabled } from '../../config/env.js'
import { notFound } from '../../lib/errors.js'
import { forgetComputer, listComputerViews, liveConnection, viewOf } from '../../remote/registry.js'
import { RemoteCallError } from '../../remote/connection.js'
import { HttpError } from '../../lib/errors.js'
import { addComputerRule, upsertComputer } from '../../remote/store.js'

// What the hub reads and writes about the computers linked to the workspace. Online or not is
// read from the socket each time, never from what the hub remembers.
export const remoteRoutes = new Hono()

remoteRoutes.use('*', async (c, next) => {
    if (!remoteComputersEnabled()) throw notFound('remote computers')
    await next()
})

remoteRoutes.get('/computers', async c => c.json({ computers: await listComputerViews() }))

remoteRoutes.put('/computers/:computerId', async c => {
    const body = remoteComputerUpsertSchema.parse(await c.req.json())
    const stored = await upsertComputer({ id: c.req.param('computerId'), handle: body.handle, name: body.name }, body.settings)
    return c.json(viewOf(stored))
})

remoteRoutes.post('/computers/:computerId/rules', async c => {
    const rule = remoteComputerRuleSchema.parse(await c.req.json())
    const stored = await addComputerRule(c.req.param('computerId'), rule)
    if (!stored) throw notFound('computer')
    return c.json(viewOf(stored))
})

remoteRoutes.delete('/computers/:computerId', async c => {
    if (!(await forgetComputer(c.req.param('computerId')))) throw notFound('computer')
    return c.json({ ok: true })
})

function connectionOf(computerId: string) {
    const connection = liveConnection(computerId)
    if (!connection) throw new HttpError(409, 'computer offline')
    return connection
}

// The engine's own bookkeeping stays out of what the hub shows.
const shown = <T extends { context?: string }>(job: T): Omit<T, 'context'> => {
    const { context: _context, ...rest } = job
    return rest
}

async function relay<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call()
    } catch (err) {
        if (err instanceof RemoteCallError) throw new HttpError(err.code === 'not_found' ? 404 : 409, err.message)
        throw err
    }
}

remoteRoutes.get('/computers/:computerId/jobs', async c => {
    const connection = connectionOf(c.req.param('computerId'))
    const { jobs } = await relay(() => connection.call('job.list', {}))
    return c.json({ jobs: jobs.map(shown) })
})

remoteRoutes.get('/computers/:computerId/jobs/:jobId', async c => {
    const connection = connectionOf(c.req.param('computerId'))
    const logs = await relay(() => connection.call('job.logs', { jobId: c.req.param('jobId'), tailBytes: 4_000 }))
    return c.json({ ...logs, job: shown(logs.job) })
})

remoteRoutes.post('/computers/:computerId/jobs/:jobId/stop', async c => {
    const connection = connectionOf(c.req.param('computerId'))
    const { job } = await relay(() => connection.call('job.stop', { jobId: c.req.param('jobId') }))
    return c.json({ job: shown(job) })
})
