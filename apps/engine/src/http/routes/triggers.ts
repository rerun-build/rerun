import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { createTriggerSchema, triggerFireSchema, updateTriggerSchema } from '@rerun/contracts'
import { deleteTrigger, isSafeSlug, listTriggers, readTrigger, rotateTriggerToken, triggerExists, writeTrigger } from '../../triggers/loader.js'
import { buildTriggerMessage } from '../../triggers/message.js'
import { fireTrigger } from '../../runtime/trigger-runner.js'
import { nowIso } from '../../lib/ids.js'

export const triggerRoutes = new Hono()

function tokenMatches(given: string, expected: string): boolean {
    const a = Buffer.from(given, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
}

triggerRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    return c.json({ triggers: await listTriggers(agentId) })
})

triggerRoutes.post('/', async c => {
    const agentId = c.req.param('id')!
    const body = createTriggerSchema.parse(await c.req.json())
    const trigger = await writeTrigger(agentId, body)
    return c.json(trigger, 201)
})

triggerRoutes.get('/:slug', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!triggerExists(agentId, slug)) return c.json({ error: 'trigger not found' }, 404)
    return c.json(await readTrigger(agentId, slug))
})

triggerRoutes.patch('/:slug', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!triggerExists(agentId, slug)) return c.json({ error: 'trigger not found' }, 404)
    const current = await readTrigger(agentId, slug)
    const body = updateTriggerSchema.parse(await c.req.json())
    const trigger = await writeTrigger(agentId, {
        name: current.name,
        description: body.description ?? current.description,
        body: body.body ?? current.body,
        methods: body.methods ?? current.methods,
        enabled: body.enabled ?? current.enabled,
        connectionId: body.connectionId !== undefined ? body.connectionId : current.connectionId,
        provider: body.provider !== undefined ? body.provider : current.provider,
        model: body.model !== undefined ? body.model : current.model,
    })
    return c.json(trigger)
})

triggerRoutes.post('/:slug/rotate', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!triggerExists(agentId, slug)) return c.json({ error: 'trigger not found' }, 404)
    return c.json(await rotateTriggerToken(agentId, slug))
})

triggerRoutes.post('/:slug/fire', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!isSafeSlug(slug) || !triggerExists(agentId, slug)) return c.json({ error: 'trigger not found' }, 404)

    const fire = triggerFireSchema.parse(await c.req.json())
    const trigger = await readTrigger(agentId, slug)
    if (!trigger.enabled || !trigger.token || !tokenMatches(fire.token, trigger.token)) return c.json({ error: 'trigger not found' }, 404)
    if (!trigger.methods.includes(fire.method)) return c.json({ error: 'method not allowed', allow: trigger.methods }, 405)

    const message = buildTriggerMessage(trigger, fire, nowIso())
    const { runId, sessionId } = await fireTrigger(agentId, trigger, message)
    return c.json({ runId, sessionId, triggerSlug: slug }, 202)
})

triggerRoutes.delete('/:slug', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!triggerExists(agentId, slug)) return c.json({ error: 'trigger not found' }, 404)
    await deleteTrigger(agentId, slug)
    return c.json({ deleted: slug })
})
