import { Hono } from 'hono'
import { RERUN_CONNECTION_ID, boxDefaultModelSchema, createConnectionSchema, customProbeInputSchema, updateConnectionKeysSchema, updateConnectionSchema } from '@rerun/contracts'
import { connectionExists, isConnected, toSummary } from '../../connections/loader.js'
import { findConnection, getConnection, listConnections } from '../../connections/registry.js'
import { assertConnectionDeletable, createConnection, deleteConnection, patchConnection, updateConnectionKeys } from '../../connections/store.js'
import { connectionUsage, releaseConnection } from '../../connections/release.js'
import { clearBoxDefault, readBoxDefault, writeBoxDefault } from '../../connections/default.js'
import { servesModel } from '../../connections/resolve.js'
import { defaultModelOf, repairBoxDefault } from '../../agents/availability.js'
import { pendingCodexPlanLimits, refreshCodexPlanLimits, refreshStaleCodexPlanLimits } from '../../connections/codex-plan-limits.js'
import { refreshOpencodeCatalog, refreshStaleOpencodeCatalog } from '../../connections/opencode-catalog.js'
import { pendingOpencodePlanLimits, refreshOpencodePlanLimits, refreshStaleOpencodePlanLimits } from '../../connections/opencode-plan-limits.js'
import { probeCustomEndpoint, refreshCustomCatalog, refreshStaleCustomCatalogs } from '../../connections/custom-catalog.js'
import type { LoadedConnection } from '../../connections/types.js'
import { sendNotification } from '../../runtime/notify.js'
import { logger } from '../../lib/logger.js'

export const connectionRoutes = new Hono()

// A run's end starts a read of its plan's limits and the hub asks for the list right after it: the
// list waits for that read, so the rings it draws are the run's. Capped, since a CLI that hangs
// must not hold the pickers; and only for reads already under way, never for a stale one started
// by this very list.
const PENDING_PLAN_LIMITS_MAX_WAIT_MS = 5_000

async function awaitPendingPlanLimits(connections: LoadedConnection[]): Promise<void> {
    const pending = connections.flatMap(connection => [pendingCodexPlanLimits(connection.id), pendingOpencodePlanLimits(connection.id)].filter((read): read is Promise<void> => !!read))
    if (!pending.length) return
    let cap: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
        Promise.all(pending),
        new Promise<void>(resolve => {
            cap = setTimeout(resolve, PENDING_PLAN_LIMITS_MAX_WAIT_MS)
        }),
    ])
    if (cap) clearTimeout(cap)
}

// Tells the hub the box now runs on the workspace's own AI, which ticks its getting-started step.
// Fire and forget: an unreachable hub never fails the write that just succeeded.
function announceConnected(connection: LoadedConnection): void {
    if (connection.id === RERUN_CONNECTION_ID || !isConnected(connection)) return
    void sendNotification({ event: 'box.connection.connected', kind: 'info', agentId: null, message: connection.config.provider })
}

connectionRoutes.get('/', async c => {
    const connections = await listConnections()
    // Off the reading already held, so the star the list returns is one the subscription serves. A
    // repair that fails (two lists writing the star at once) leaves the stored one for the next list.
    for (const connection of connections) {
        await repairBoxDefault(connection).catch(err => logger.warn({ err: String(err), connection: connection.id }, 'box default repair failed'))
    }
    await awaitPendingPlanLimits(connections)
    refreshStaleCodexPlanLimits(connections)
    refreshStaleOpencodePlanLimits(connections)
    if (connections.some(connection => connection.config.provider === 'opencode')) refreshStaleOpencodeCatalog()
    refreshStaleCustomCatalogs(connections)
    return c.json({ connections: connections.map(toSummary), default: await readBoxDefault() })
})

// Registered before `/:id`: Hono matches same-method routes in registration order, so `/default`
// would otherwise be read as a connection id.
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

// Asked from the box rather than from the hub: on a self-hosted install the endpoint sits on the
// owner's machine or network, which only the engine can reach. The hub vets the address first.
connectionRoutes.post('/probe', async c => {
    const input = customProbeInputSchema.parse(await c.req.json())
    return c.json(await probeCustomEndpoint(input))
})

connectionRoutes.post('/', async c => {
    const body = createConnectionSchema.parse(await c.req.json())
    const connection = await createConnection(body)
    await readCliModelsBeforeAdopting(connection)
    await adoptBoxDefault(connection)
    announceConnected(connection)
    return c.json(toSummary(connection), 201)
})

connectionRoutes.patch('/:id', async c => {
    const id = c.req.param('id')
    if (!connectionExists(id)) return c.json({ error: 'connection not found' }, 404)
    const patch = updateConnectionSchema.parse(await c.req.json())
    const connection = await patchConnection(id, patch)
    if (patch.baseUrl !== undefined) await refreshCustomCatalog(connection)
    // Switching off the model the box default names would leave every agent that picked nothing
    // dropping to Rerun with nothing on screen saying so. This is the one write that can see it.
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
    await readCliModelsBeforeAdopting(connection)
    await adoptBoxDefault(connection)
    announceConnected(connection)
    return c.json({ keys })
})

// What a delete would move back onto the box default, so the UI can name it before it happens.
connectionRoutes.get('/:id/usage', async c => {
    const id = c.req.param('id')
    if (!connectionExists(id)) return c.json({ error: 'connection not found' }, 404)
    return c.json(await connectionUsage(id))
})

connectionRoutes.delete('/:id', async c => {
    const id = c.req.param('id')
    if (!connectionExists(id)) return c.json({ error: 'connection not found' }, 404)
    // Before the release, not after: detaching every agent and then refusing the delete would leave
    // the box worse off than a plain refusal.
    assertConnectionDeletable(id)
    const released = await releaseConnection(id)
    await deleteConnection(id)
    return c.json({ deleted: id, released })
})

// The first default a box adopts must be a model the account's Codex serves, and the only reading
// that can say so is the one taken against the credential that just arrived. Awaited here, a few
// seconds at most, because the adoption below is the one write that cannot wait for the next list.
// OpenCode's live catalog says the same of a model it stopped publishing. Nothing to read for the
// other providers: Claude refuses nothing, a key has no CLI.
async function readCliModelsBeforeAdopting(connection: LoadedConnection): Promise<void> {
    if (connection.config.provider === 'codex') await refreshCodexPlanLimits(connection)
    if (connection.config.provider === 'opencode') await Promise.all([refreshOpencodeCatalog(), refreshOpencodePlanLimits(connection)])
    if (connection.config.provider === 'custom') await refreshCustomCatalog(connection)
}

// Plugging the first credential into a box is the whole setup, and on its own it changes nothing:
// with no default written, the resolution ladder keeps every agent on the keyless Rerun connection
// until someone finds the star in the connection detail. So the first one adopts the default.
//
// Only while nothing else is plugged in — moving the default onto a connection added next to a
// working one would move the bill without anyone asking.
async function adoptBoxDefault(connection: LoadedConnection): Promise<void> {
    if (connection.id === RERUN_CONNECTION_ID || !isConnected(connection)) return
    if (await readBoxDefault()) return
    const others = (await listConnections()).filter(c => c.id !== connection.id && c.id !== RERUN_CONNECTION_ID)
    if (others.some(isConnected)) return
    const model = defaultModelOf(connection)
    // `defaultModelOf` falls back to the provider default on a connection offering nothing, and a
    // pair no list serves would star a row the UI never shows.
    if (!servesModel(connection, model)) return
    await writeBoxDefault({ connectionId: connection.id, model })
}
