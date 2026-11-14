import { DEFAULT_PROVIDER_MODEL, RERUN_CONNECTION_ID, RERUN_MODEL, cliServesModel, opencodeServesModel, type AgentConfig, type Provider } from '@rerun/contracts'
import { liveOpencodeProviderModels } from '../connections/opencode-catalog.js'
import { readCliModels } from '../connections/cli-models.js'
import { readBoxDefault, writeBoxDefault } from '../connections/default.js'
import { allowedModel } from '../connections/plan.js'
import { findConnection, listConnections } from '../connections/registry.js'
import { isConnected } from '../connections/loader.js'
import { resolveConnection, servesModel } from '../connections/resolve.js'
import type { LoadedConnection } from '../connections/types.js'
import { logger } from '../lib/logger.js'
import type { ModelOverride } from './providers.js'
import type { LoadedAgent } from './types.js'

export type RunModel = { connection: LoadedConnection | null; provider: Provider; model: string }

function servedByProvider(connection: LoadedConnection, model: string): boolean {
    const { provider } = connection.config
    const opencodeModels = provider === 'opencode' ? liveOpencodeProviderModels() : null
    return cliServesModel(provider, readCliModels(connection.id), model) && opencodeServesModel(provider, opencodeModels, model)
}

export function isUsable(connection: LoadedConnection | null, model: string | null | undefined): boolean {
    if (!connection || !model) return false
    return isConnected(connection) && servesModel(connection, model) && servedByProvider(connection, model)
}

export function defaultModelOf(connection: LoadedConnection): string {
    const { provider, models, extraModels } = connection.config
    const offered = [...models, ...extraModels]
    const runsAsIs = (model: string): boolean => allowedModel(provider, model) === model
    return offered.find(model => runsAsIs(model) && servedByProvider(connection, model)) ?? offered.find(runsAsIs) ?? offered[0] ?? DEFAULT_PROVIDER_MODEL[provider]
}

export async function repairBoxDefault(connection: LoadedConnection): Promise<void> {
    const stored = await readBoxDefault()
    if (!stored || stored.connectionId !== connection.id || !isConnected(connection)) return
    if (servedByProvider(connection, stored.model)) return
    const model = defaultModelOf(connection)
    if (model === stored.model || !isUsable(connection, model)) return
    await writeBoxDefault({ connectionId: connection.id, model })
    logger.warn({ connection: connection.id, from: stored.model, to: model }, 'box default not served by the subscription, moved')
}

function pick(connection: LoadedConnection, model: string): RunModel {
    return { connection, provider: connection.config.provider, model: allowedModel(connection.config.provider, model) }
}

export async function boxDefaultModel(): Promise<RunModel> {
    const configured = await readBoxDefault()
    const direct = await findConnection(configured?.connectionId)
    if (configured && isUsable(direct, configured.model)) return pick(direct!, configured.model)
    if (configured && direct && isConnected(direct) && servesModel(direct, configured.model)) {
        const model = defaultModelOf(direct)
        if (isUsable(direct, model)) return pick(direct, model)
    }

    const all = await listConnections()
    const rerun = all.find(c => c.id === RERUN_CONNECTION_ID)
    const candidates = [...(rerun ? [rerun] : []), ...all]
    for (const connection of candidates) {
        const model = defaultModelOf(connection)
        if (isUsable(connection, model)) return pick(connection, model)
    }
    return { connection: rerun ?? null, provider: 'rerun', model: RERUN_MODEL }
}

export async function resolveConfiguredModel(config: Pick<AgentConfig, 'connectionId' | 'provider' | 'model'>): Promise<RunModel> {
    if (!config.model) return boxDefaultModel()
    const connection = await resolveConnection(config.connectionId, config.provider)
    const provider = connection?.config.provider ?? config.provider ?? 'rerun'
    return { connection, provider, model: allowedModel(provider, config.model) }
}

export async function resolveRunModel(agent: LoadedAgent, override?: ModelOverride): Promise<RunModel> {
    if (!override?.connectionId && !override?.provider && !override?.model) return agent.resolved
    const connection = await resolveConnection(override.connectionId ?? agent.config.connectionId, override.provider ?? agent.config.provider)
    const provider = connection?.config.provider ?? override.provider ?? agent.resolved.provider
    return { connection, provider, model: allowedModel(provider, override.model ?? agent.resolved.model) }
}

export async function resolveAutomationModel(agent: LoadedAgent, requested?: ModelOverride): Promise<ModelOverride> {
    const asked = requested?.model ? await resolveRunModel(agent, requested) : null
    if (asked && isUsable(asked.connection, asked.model)) return toOverride(asked)
    if (isUsable(agent.resolved.connection, agent.resolved.model)) return toOverride(agent.resolved)
    const fallback = await boxDefaultModel()
    return toOverride(isUsable(fallback.connection, fallback.model) ? fallback : agent.resolved)
}

function toOverride(run: RunModel): ModelOverride {
    return { connectionId: run.connection?.id, provider: run.provider, model: run.model }
}

type Automation = { slug: string; connectionId: string | null; model: string | null }

export async function automationModel(agent: LoadedAgent, automation: Automation, source: 'schedule' | 'trigger'): Promise<ModelOverride> {
    const requested = automation.model ? { connectionId: automation.connectionId ?? undefined, model: automation.model } : undefined
    const resolved = await resolveAutomationModel(agent, requested)
    const asked = `${requested?.connectionId ?? agent.resolved.connection?.id ?? 'none'}:${requested?.model ?? agent.resolved.model}`
    const using = `${resolved.connectionId ?? 'none'}:${resolved.model}`
    const fields = { agent: agent.id, source, slug: automation.slug, requested: asked, using }
    if (asked !== using) logger.warn(fields, 'connection unavailable, falling back')
    return resolved
}
