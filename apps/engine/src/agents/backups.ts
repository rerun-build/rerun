import { RERUN_CONNECTION_ID, type ProviderSwitch } from '@rerun/contracts'
import { readBoxBackups } from '../connections/backups.js'
import { isPlanLimitLatched, spentPlanWindow } from '../connections/plan-limits.js'
import { findConnection } from '../connections/registry.js'
import { isBudgetLatched } from '../runtime/budget-latch.js'
import { defaultModelOf, isUsable, resolveRunModel, type RunModel } from './availability.js'
import type { ModelOverride } from './providers.js'
import type { LoadedAgent } from './types.js'

// The next model a turn can move to once the subscription it ran on is out: the listed backups in
// their order, then the Rerun credit when the owner switched it on. A backup on a connection already
// tried is skipped whatever its model, since the limit belongs to the subscription.
export async function pickBackup(tried: ReadonlySet<string>): Promise<RunModel | null> {
    const { backups, rerunCreditLastResort } = await readBoxBackups()
    for (const backup of backups) {
        if (tried.has(backup.connectionId) || isPlanLimitLatched(backup.connectionId)) continue
        const connection = await findConnection(backup.connectionId)
        if (connection && isUsable(connection, backup.model)) return { connection, provider: connection.config.provider, model: backup.model }
    }
    if (!rerunCreditLastResort || tried.has(RERUN_CONNECTION_ID) || isBudgetLatched()) return null
    const rerun = await findConnection(RERUN_CONNECTION_ID)
    if (!rerun) return null
    const model = defaultModelOf(rerun)
    return isUsable(rerun, model) ? { connection: rerun, provider: rerun.config.provider, model } : null
}

export async function hasBackups(): Promise<boolean> {
    const { backups, rerunCreditLastResort } = await readBoxBackups()
    return backups.length > 0 || rerunCreditLastResort
}

// What a run is served on: the pair it asked for, or a backup while that pair's subscription is out.
// `askedOut` tells a subscription that came back from one still out with no backup free to take over.
export async function servedRunModel(agent: LoadedAgent, override?: ModelOverride): Promise<{ served: RunModel; asked: RunModel; askedOut: boolean }> {
    const asked = await resolveRunModel(agent, override)
    const connectionId = asked.connection?.id
    if (!connectionId || connectionId === RERUN_CONNECTION_ID || !isPlanLimitLatched(connectionId)) return { served: asked, asked, askedOut: false }
    const backup = await pickBackup(new Set([connectionId]))
    return { served: backup ?? asked, asked, askedOut: true }
}

function endOf(run: RunModel): ProviderSwitch['from'] {
    return { connectionId: run.connection?.id ?? RERUN_CONNECTION_ID, provider: run.provider, model: run.model, name: run.connection?.config.name ?? run.provider }
}

const samePair = (end: ProviderSwitch['to'], run: RunModel): boolean => end.connectionId === (run.connection?.id ?? RERUN_CONNECTION_ID) && end.model === run.model

export function limitReached(from: RunModel, to: RunModel): ProviderSwitch {
    const resetsAt = from.connection ? (spentPlanWindow(from.connection.id)?.resetsAt ?? null) : null
    return { kind: 'switch', from: endOf(from), to: endOf(to), resetsAt }
}

// The line a turn opens with, if any. A conversation already on this backup says nothing again; one
// that ran on a backup and is now served by the subscription it left says it is back, unless that
// subscription is still out and only serves the turn because no backup is free.
export function switchOpeningTurn(asked: RunModel, served: RunModel, last: ProviderSwitch | null, askedOut: boolean): ProviderSwitch | undefined {
    if (served !== asked) return last?.kind === 'switch' && samePair(last.to, served) ? undefined : limitReached(asked, served)
    if (askedOut || last?.kind !== 'switch' || last.from.connectionId !== served.connection?.id || samePair(last.to, served)) return undefined
    return { kind: 'back', from: last.to, to: endOf(served), resetsAt: null }
}
