import { cliUnavailableReason, inPlanOrder, inTierOrder, isHiddenModel, isModelLocked, livePlanWindows, modelDescription, type SourceCopy } from '@/lib/engine/ai-sources'
import { modelLabel, modelPower } from '@/lib/engine/models'
import type { BoxConnection, EngineProvider } from '@/lib/engine/types'
import { RERUN_CONNECTION_ID, type PlanLimitWindow } from '@moldwright/contracts'

export type ConnectionGroup = {
    connectionId: string
    label: string
    provider: EngineProvider
    models: { id: string; label: string; power?: number; description?: string; locked?: boolean; unavailable?: string }[]
    defaultModel: string
    planWindows: PlanLimitWindow[]
}

export function pinFirst<T>(items: T[], match: (item: T) => boolean): T[] {
    const at = items.findIndex(match)
    return at <= 0 ? items : [items[at], ...items.slice(0, at), ...items.slice(at + 1)]
}

export function toGroup(connection: BoxConnection, premiumAllowed: boolean, t: SourceCopy): ConnectionGroup {
    const offered = connection.models.filter(id => !isHiddenModel(connection.id, id))
    const catalog = offered.map(id => ({
        id,
        label: modelLabel(id),
        power: modelPower(id),
        description: modelDescription(connection, id, t),
        locked: isModelLocked(connection.id, id, premiumAllowed),
        unavailable: cliUnavailableReason(connection, id, t),
    }))
    const extra = connection.extraModels.map(id => ({ id, label: id, locked: isModelLocked(connection.id, id, premiumAllowed), unavailable: cliUnavailableReason(connection, id, t) }))
    const models = inPlanOrder(connection.provider, inTierOrder(connection.id, [...catalog, ...extra]))
    const runnable = [...offered, ...connection.extraModels]
    const runsAsIs = (id: string) => !isModelLocked(connection.id, id, premiumAllowed)
    const defaultModel = runnable.find(id => runsAsIs(id) && !cliUnavailableReason(connection, id, t)) ?? runnable.find(runsAsIs) ?? runnable[0] ?? ''
    return { connectionId: connection.id, label: connection.name, provider: connection.provider, models, defaultModel, planWindows: livePlanWindows(connection) }
}


export function refusedModelReason(group: Pick<ConnectionGroup, 'models'> | undefined, model: string | null | undefined): string | undefined {
    if (!group || !model) return undefined
    return group.models.find(m => m.id === model)?.unavailable
}

export function connectionGroups(connections: BoxConnection[], premiumAllowed: boolean, t: SourceCopy): ConnectionGroup[] {
    return pinFirst(
        connections
            .filter(connection => connection.connected)
            .map(connection => toGroup(connection, premiumAllowed, t))
            .filter(group => group.models.length > 0),
        group => group.connectionId === RERUN_CONNECTION_ID
    )
}
