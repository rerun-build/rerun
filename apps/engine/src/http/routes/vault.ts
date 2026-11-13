import { Hono } from 'hono'
import { mcpTokenSchema, MCP_SERVER_NAME_RE } from '@rerun/contracts'
import { badRequest } from '../../lib/errors.js'
import {
    attachVaultItem,
    createVaultItem,
    deleteVaultItem,
    detachVaultItem,
    getVaultItem,
    listVaultItems,
    toVaultSummary,
    updateVaultItem,
    updateVaultItemEnv,
    vaultItemExists,
    vaultItemUsage,
    isAttachedTo,
} from '../../vault/store.js'
import { clearVaultToken, saveVaultToken } from '../../vault/tokens.js'

export const vaultRoutes = new Hono()

// `?agent=<id>` narrows the list to what one coworker draws on: its own items and the shared ones.
vaultRoutes.get('/', async c => {
    const agentId = c.req.query('agent')
    const items = (await listVaultItems()).filter(item => !agentId || isAttachedTo(item, agentId))
    return c.json({ items: await Promise.all(items.map(toVaultSummary)) })
})

vaultRoutes.post('/', async c => {
    const item = await createVaultItem(await c.req.json())
    return c.json(await toVaultSummary(item), 201)
})

vaultRoutes.get('/:id', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    return c.json(await toVaultSummary(await getVaultItem(id)))
})

vaultRoutes.patch('/:id', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    return c.json(await toVaultSummary(await updateVaultItem(id, await c.req.json())))
})

// Answers the names of the variables the item now holds, never a value.
vaultRoutes.patch('/:id/env', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    const item = await updateVaultItemEnv(id, await c.req.json())
    return c.json({ keys: Object.keys(item.env).sort() })
})

vaultRoutes.put('/:id/agents/:agentId', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    return c.json(await toVaultSummary(await attachVaultItem(id, c.req.param('agentId'))))
})

vaultRoutes.delete('/:id/agents/:agentId', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    return c.json(await toVaultSummary(await detachVaultItem(id, c.req.param('agentId'))))
})

function serverParam(name: string): string {
    if (!MCP_SERVER_NAME_RE.test(name)) throw badRequest(`Invalid MCP server name: ${JSON.stringify(name)}`)
    return name
}

vaultRoutes.put('/:id/tokens/:server', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    const token = mcpTokenSchema.parse(await c.req.json())
    await saveVaultToken(id, serverParam(c.req.param('server')), { ...token, obtainedAt: token.obtainedAt ?? Date.now() })
    return c.json({ ok: true })
})

vaultRoutes.delete('/:id/tokens/:server', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    await clearVaultToken(id, serverParam(c.req.param('server')))
    return c.json({ ok: true })
})

// Who loses the item if it goes, for the UI to name them before the delete.
vaultRoutes.get('/:id/usage', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    return c.json({ agentIds: await vaultItemUsage(await getVaultItem(id)) })
})

vaultRoutes.delete('/:id', async c => {
    const id = c.req.param('id')
    if (!vaultItemExists(id)) return c.json({ error: 'vault item not found' }, 404)
    const { detached } = await deleteVaultItem(id)
    return c.json({ deleted: id, detached })
})
