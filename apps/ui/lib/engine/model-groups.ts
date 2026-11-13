import { cliUnavailableReason, inPlanOrder, inTierOrder, isHiddenModel, livePlanWindows, modelDescription, type SourceCopy } from '@/lib/engine/ai-sources'
import { modelLabel, modelPower } from '@/lib/engine/models'
import type { BoxConnection, EngineProvider } from '@/lib/engine/types'
import { RERUN_CONNECTION_ID, type PlanLimitWindow } from '@rerun/contracts'

export type ConnectionGroup = {
    connectionId: string
    label: string
    provider: EngineProvider
    // `description` is set on the Rerun tiers and the OpenCode models (Go or Console), which read as
    // two-line rows. One group per connection even for OpenCode's two catalogs: the iOS app keys the
    // running model on the connection. `unavailable` is why the subscription's CLI cannot run it on
    // this box: the row is disabled and says so.
    models: { id: string; label: string; power?: number; description?: string; unavailable?: string }[]
    // What the connection runs when no model is named, as the engine reads it: the first id of its
    // own list, not the first row shown.
    defaultModel: string
    // Where a subscription stands against its plan. Empty for anything that is not one.
    planWindows: PlanLimitWindow[]
}

// Rerun heads every picker: the keyless connection is the one that runs without the user bringing
// a key, and its rank must not depend on the order the engine happened to read its connections
// directory in. Moving one entry rather than sorting keeps the rest as the box set it.
export function pinFirst<T>(items: T[], match: (item: T) => boolean): T[] {
    const at = items.findIndex(match)
    return at <= 0 ? items : [items[at], ...items.slice(0, at), ...items.slice(at + 1)]
}

// One group per usable Box connection, shared by every model picker (in-chat ModelSelector,
// scheduled-task editor) so they never drift. Two Claude subscriptions show up as two groups —
// that is the whole point of moving credentials up to the Box.
//
// A connection with no credential is dropped rather than shown greyed out: the connections tab is
// where you fix that, and a picker offering a model that cannot run is a trap.
export function toGroup(connection: BoxConnection, t: SourceCopy): ConnectionGroup {
    const offered = connection.models.filter(id => !isHiddenModel(connection.id, id))
    const catalog = offered.map(id => ({
        id,
        label: modelLabel(id),
        power: modelPower(id),
        description: modelDescription(connection, id, t),
        unavailable: cliUnavailableReason(connection, id, t),
    }))
    // Ids the catalog does not know (a custom router's own): the id is the only label there is.
    const extra = connection.extraModels.map(id => ({ id, label: id, unavailable: cliUnavailableReason(connection, id, t) }))
    const models = inPlanOrder(connection.provider, inTierOrder(connection.id, [...catalog, ...extra]))
    // The engine skips what the CLI does not serve when it picks a connection's default.
    const runnable = [...offered, ...connection.extraModels]
    const defaultModel = runnable.find(id => !cliUnavailableReason(connection, id, t)) ?? runnable[0] ?? ''
    return { connectionId: connection.id, label: connection.name, provider: connection.provider, models, defaultModel, planWindows: livePlanWindows(connection) }
}


// Why the subscription behind the pair the next turn bills refuses its model, when it does: a
// ChatGPT plan without it answers with a 400, so the composer holds the message back instead.
export function refusedModelReason(group: Pick<ConnectionGroup, 'models'> | undefined, model: string | null | undefined): string | undefined {
    if (!group || !model) return undefined
    return group.models.find(m => m.id === model)?.unavailable
}

// The groups every picker offers, Rerun first: shared by the web hook and the app's /api/v1 route.
export function connectionGroups(connections: BoxConnection[], t: SourceCopy): ConnectionGroup[] {
    return pinFirst(
        connections
            .filter(connection => connection.connected)
            .map(connection => toGroup(connection, t))
            .filter(group => group.models.length > 0),
        group => group.connectionId === RERUN_CONNECTION_ID
    )
}
