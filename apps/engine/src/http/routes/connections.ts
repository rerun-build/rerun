import { Hono } from 'hono'
import { RERUN_CONNECTION_ID, boxDefaultModelSchema, createConnectionSchema, customProbeInputSchema, updateConnectionKeysSchema, updateConnectionSchema } from '@moldwright/contracts'
import { connectionExists, isConnected, toSummary } from '../../connections/loader.js'
import { findConnection, getConnection, listConnections } from '../../connections/registry.js'
import { assertConnectionDeletable, createConnection, deleteConnection, patchConnection, updateConnectionKeys } from '../../connections/store.js'
import { connectionUsage, releaseConnection } from '../../connections/release.js'
import { clearBoxDefault, readBoxDefault, writeBoxDefault } from '../../connections/default.js'
import { servesModel } from '../../connections/resolve.js'
import { defaultModelOf, repairBoxDefault } from '../../agents/availability.js'
import { refreshStaleClaudePlanLimits } from '../../connections/claude-plan-limits.js'
import { refreshCodexPlanLimits, refreshStaleCodexPlanLimits } from '../../connections/codex-plan-limits.js'
import { refreshOpencodeCatalog, refreshStaleOpencodeCatalog } from '../../connections/opencode-catalog.js'
import { refreshOpencodePlanLimits, refreshStaleOpencodePlanLimits } from '../../connections/opencode-plan-limits.js'
import { awaitPendingPlanLimits } from '../../connections/plan-limits-pending.js'
import { probeCustomEndpoint, refreshCustomCatalog, refreshStaleCustomCatalogs } from '../../connections/custom-catalog.js'
import { refreshProviderCatalog, refreshStaleProviderCatalogs } from '../../connections/provider-catalog.js'
import type { LoadedConnection } from '../../connections/types.js'
import { sendNotification } from '../../runtime/notify.js'
import { logger } from '../../lib/logger.js'

export const connectionRoutes = new Hono()

function announceConnected(connection: LoadedConnection): void {
    if (connection.id === RERUN_CONNECTION_ID || !isConnected(connection)) return
    void sendNotification({ event: 'box.connection.connected', kind: 'info', agentId: null, message: connection.config.provider })
}

connectionRoutes.get('/', async c => {
    const connections = await listConnections()
    for (const connection of connections) {
        await repairBoxDefault(connection).catch(err => logger.warn({ err: String(err), connection: connection.id }, 'box default repair failed'))
    }
    await awaitPendingPlanLimits(connections)
    refreshStaleClaudePlanLimits(connections)
    refreshStaleCodexPlanLimits(connections)
    refreshStaleOpencodePlanLimits(connections)
    if (connections.some(connection => connection.config.provider === 'opencode')) refreshStaleOpencodeCatalog()
    refreshStaleCustomCatalogs(connections)
    refreshStaleProviderCatalogs(connections)
    return c.json({ connections: connections.map(toSummary), default: await readBoxDefault() })
})

connectionRoutes.put('/default', async c => {
    const { connectionId, model } = boxDefaultModelSchema.parse(await c.req.json())
    const connection = await findConnection(connectionId)
    if (!connection) return c.json({ error: 'connection not found' }, 404)
    if (!servesModel(connection, model)) return c.json({ error: `This connection does not offer ${model}` }, 400)
    return c.json(await writeBoxDefault({ connectionId, model }))
})

connectionRoutes.delete('/default', async c => {
    await clearBoxDefault()
    return c.json({ default: null })
})

connectionRoutes.post('/probe', async c => {
    const input = customProbeInputSchema.parse(await c.req.json())
    return c.json(await probeCustomEndpoint(input))
})

connectionRoutes.post('/', async c => {
    const body = createConnectionSchema.parse(await c.req.json())
    const connection = await createConnection(body)
    await Promise.all([readCliModelsBeforeAdopting(connection), refreshProviderCatalog(connection)])
    await adoptBoxDefault(connection)
    announceConnected(connection)
    return c.json(toSummary(connection), 201)
})

connectionRoutes.patch('/:id', async c => {
    const id = c.req.param('id')
    if (!connectionExists(id)) return c.json({ error: 'connection not found' }, 404)
    const patch = updateConnectionSchema.parse(await c.req.json())
    const connection = await patchConnection(id, patch)
    if (patch.baseUrl !== undefined) await Promise.all([refreshCustomCatalog(connection), refreshProviderCatalog(connection)])
    const boxDefault = await readBoxDefault()
    if (boxDefault?.connectionId === id && !servesModel(connection, boxDefault.model)) await writeBoxDefault({ connectionId: id, model: defaultModelOf(connection) })
    return c.json(toSummary(connection))
})

connectionRoutes.patch('/:id/keys', async c => {
    const id = c.req.param('id')
    if (!connectionExists(id)) return c.json({ error: 'connection not found' }, 404)
    const body = updateConnectionKeysSchema.parse(await c.req.json())
    const keys = await updateConnectionKeys(id, body)
    const connection = await getConnection(id)
    void refreshProviderCatalog(connection)
    await readCliModelsBeforeAdopting(connection)
    await adoptBoxDefault(connection)
    announceConnected(connection)
    return c.json({ keys })
})

connectionRoutes.get('/:id/usage', async c => {
    const id = c.req.param('id')
    if (!connectionExists(id)) return c.json({ error: 'connection not found' }, 404)
    return c.json(await connectionUsage(id))
})

connectionRoutes.delete('/:id', async c => {
    const id = c.req.param('id')
    if (!connectionExists(id)) return c.json({ error: 'connection not found' }, 404)
    assertConnectionDeletable(id)
    const released = await releaseConnection(id)
    await deleteConnection(id)
    return c.json({ deleted: id, released })
})

async function readCliModelsBeforeAdopting(connection: LoadedConnection): Promise<void> {
    if (connection.config.provider === 'codex') await refreshCodexPlanLimits(connection)
    if (connection.config.provider === 'opencode') await Promise.all([refreshOpencodeCatalog(), refreshOpencodePlanLimits(connection)])
    if (connection.config.provider === 'custom') await refreshCustomCatalog(connection)
}

async function adoptBoxDefault(connection: LoadedConnection): Promise<void> {
    if (connection.id === RERUN_CONNECTION_ID || !isConnected(connection)) return
    if (await readBoxDefault()) return
    const others = (await listConnections()).filter(c => c.id !== connection.id && c.id !== RERUN_CONNECTION_ID)
    if (others.some(isConnected)) return
    const model = defaultModelOf(connection)
    if (!servesModel(connection, model)) return
    await writeBoxDefault({ connectionId: connection.id, model })
}
