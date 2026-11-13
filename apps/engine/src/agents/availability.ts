import { DEFAULT_PROVIDER_MODEL, RERUN_CONNECTION_ID, RERUN_MODEL, cliServesModel, opencodeServesModel, type AgentConfig, type Provider } from '@rerun/contracts'
import { liveOpencodeProviderModels } from '../connections/opencode-catalog.js'
import { readCliModels } from '../connections/cli-models.js'
import { readBoxDefault, writeBoxDefault } from '../connections/default.js'
import { findConnection, listConnections } from '../connections/registry.js'
import { isConnected } from '../connections/loader.js'
import { resolveConnection, servesModel } from '../connections/resolve.js'
import type { LoadedConnection } from '../connections/types.js'
import { logger } from '../lib/logger.js'
import type { ModelOverride } from './providers.js'
import type { LoadedAgent } from './types.js'

// The pair a run actually bills. `model` is never null here: this is the answer, not the setting.
export type RunModel = { connection: LoadedConnection | null; provider: Provider; model: string }

// What the subscription behind the connection accepts, past the list the box owner curated: Codex
// answers for the account (a ChatGPT plan without the model refuses it with a 400), OpenCode for
// the models it still publishes. Without a reading nothing is refused.
function servedByProvider(connection: LoadedConnection, model: string): boolean {
    const { provider } = connection.config
    const opencodeModels = provider === 'opencode' ? liveOpencodeProviderModels() : null
    return cliServesModel(provider, readCliModels(connection.id), model) && opencodeServesModel(provider, opencodeModels, model)
}

// A connection can run a model when its credential is present, the model is one it offers and its
// subscription serves it. Each part matters: a connected subscription still fails on a model the
// user switched off or the plan leaves out, and a curated list means nothing without a token.
export function isUsable(connection: LoadedConnection | null, model: string | null | undefined): boolean {
    if (!connection || !model) return false
    return isConnected(connection) && servesModel(connection, model) && servedByProvider(connection, model)
}

// What the connection would run if no model were named. Its own first entry rather than the
// provider default, because the box owner curated that list on purpose. The first one the
// subscription's CLI serves, so the default a box adopts on connect is never a model it cannot run.
// OpenCode's live catalog says the same of a model it stopped publishing.
export function defaultModelOf(connection: LoadedConnection): string {
    const { provider, models, extraModels } = connection.config
    const offered = [...models, ...extraModels]
    return offered.find(model => servedByProvider(connection, model)) ?? offered[0] ?? DEFAULT_PROVIDER_MODEL[provider]
}

// A default starred before the subscription said which models it serves names a model every agent
// following it fails on. It moves to the first model the same
// connection serves: the bill stays where the owner put it, only the model changes. Nothing is
// written while no served model is known, a wrong guess would be worse than the stored pick.
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
    return { connection, provider: connection.config.provider, model }
}

// What the box runs for every agent that named no model of its own, and the only place the fallback
// ladder is written down: the pair the owner set, then the keyless Rerun connection, then whatever
// else is plugged in.
//
// The last line is what makes this change invisible on a box nobody has configured: no default set
// and no credential resolves to exactly what the hardcoded config defaults used to say.
export async function boxDefaultModel(): Promise<RunModel> {
    const configured = await readBoxDefault()
    const direct = await findConnection(configured?.connectionId)
    if (configured && isUsable(direct, configured.model)) return pick(direct!, configured.model)
    // The owner's connection is fine, only its model is refused: walking the ladder would start on
    // the keyless Rerun connection and move the bill.
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

// What a stored config runs on. `model === null` is the whole switch: the agent picked nothing, so
// the box answers for it. Anything else is a pin and is returned as asked, usable or not, so a
// credential pulled from under a pinned agent fails loudly instead of being swapped in silence.
export async function resolveConfiguredModel(config: Pick<AgentConfig, 'connectionId' | 'provider' | 'model'>): Promise<RunModel> {
    if (!config.model) return boxDefaultModel()
    const connection = await resolveConnection(config.connectionId, config.provider)
    const provider = connection?.config.provider ?? config.provider ?? 'rerun'
    return { connection, provider, model: config.model }
}

// The same answer with a run's override laid on top. The override names a connection and a model;
// the provider is always the resolved connection's.
export async function resolveRunModel(agent: LoadedAgent, override?: ModelOverride): Promise<RunModel> {
    if (!override?.connectionId && !override?.provider && !override?.model) return agent.resolved
    const connection = await resolveConnection(override.connectionId ?? agent.config.connectionId, override.provider ?? agent.config.provider)
    const provider = connection?.config.provider ?? override.provider ?? agent.resolved.provider
    return { connection, provider, model: override.model ?? agent.resolved.model }
}

// An automation carries a pair frozen when it was written, and nothing repairs it when the
// credential behind it is removed. Same chain as a chat run, plus the repair pass an unattended run
// needs: what the automation asked for, then what the agent runs, then the box default.
//
// Falling back to the agent's own pair when nothing is usable is deliberate: a box with no
// credentials at all keeps failing exactly as it does today rather than on a surprise substitute.
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

// What a schedule or a trigger runs under. `warn` rather than `info` on the fallback: a connection
// swapped without anyone asking changes both the bill and the quality of the answer.
export async function automationModel(agent: LoadedAgent, automation: Automation, source: 'schedule' | 'trigger'): Promise<ModelOverride> {
    const requested = automation.model ? { connectionId: automation.connectionId ?? undefined, model: automation.model } : undefined
    const resolved = await resolveAutomationModel(agent, requested)
    const asked = `${requested?.connectionId ?? agent.resolved.connection?.id ?? 'none'}:${requested?.model ?? agent.resolved.model}`
    const using = `${resolved.connectionId ?? 'none'}:${resolved.model}`
    const fields = { agent: agent.id, source, slug: automation.slug, requested: asked, using }
    if (asked !== using) logger.warn(fields, 'connection unavailable, falling back')
    return resolved
}
