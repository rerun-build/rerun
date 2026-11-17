import { Hono } from 'hono'
import { remoteComputerRuleSchema, remoteComputerUpsertSchema } from '@rerun/contracts'
import { remoteComputersEnabled } from '../../config/env.js'
import { notFound } from '../../lib/errors.js'
import { forgetComputer, listComputerViews, viewOf } from '../../remote/registry.js'
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
