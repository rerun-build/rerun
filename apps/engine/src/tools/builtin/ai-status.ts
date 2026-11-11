import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { PROVIDER_LABELS, creditsFromMicros, type HubRerunCredit, type Provider } from '@rerun/contracts'
import { isUsable } from '../../agents/availability.js'
import { answeringModel } from '../../agents/rerun-upstream.js'
import { refreshStaleCodexPlanLimits } from '../../connections/codex-plan-limits.js'
import { readBoxDefault } from '../../connections/default.js'
import { toSummary } from '../../connections/loader.js'
import { refreshStaleOpencodePlanLimits } from '../../connections/opencode-plan-limits.js'
import { isPlanLimitLatched } from '../../connections/plan-limits.js'
import { awaitPendingPlanLimits } from '../../connections/plan-limits-pending.js'
import { listConnections } from '../../connections/registry.js'
import type { LoadedConnection } from '../../connections/types.js'
import type { RunContext } from '../../runtime/context.js'
import { callHub } from '../../runtime/hub.js'

const SUBSCRIPTION_PROVIDERS: ReadonlySet<Provider> = new Set(['claude', 'codex', 'opencode'])

function billing(provider: Provider): 'rerun_credit' | 'subscription' | 'api_key' {
    if (provider === 'rerun') return 'rerun_credit'
    return SUBSCRIPTION_PROVIDERS.has(provider) ? 'subscription' : 'api_key'
}

function describeConnection(connection: LoadedConnection) {
    const summary = toSummary(connection)
    return {
        id: connection.id,
        name: connection.config.name,
        provider: PROVIDER_LABELS[connection.config.provider],
        billing: billing(connection.config.provider),
        connected: summary.connected,
        credentialRejected: summary.credentialRejected,
        models: [...new Set([...connection.config.models, ...connection.config.extraModels])].filter(model => isUsable(connection, model)),
        planLimits: summary.planLimits ? { windows: summary.planLimits.windows, readAt: summary.planLimits.capturedAt } : null,
        limitReached: isPlanLimitLatched(connection.id),
    }
}

// The credit lives on the hub: a hub that does not answer leaves it out rather than failing the read.
async function readRerunCredit(ctx: RunContext) {
    try {
        const { credit } = (await callHub(ctx.agent, 'rerun_credit', {})) as { credit?: HubRerunCredit | null }
        if (!credit) return null
        return {
            remainingCredits: creditsFromMicros(credit.remainingMicros),
            usedCredits: creditsFromMicros(credit.usedMicros),
            totalCredits: creditsFromMicros(credit.totalMicros),
            paused: credit.paused,
            resetsAt: credit.resetsAt,
        }
    } catch {
        return null
    }
}

export function aiStatusTools(ctx: RunContext): ToolSet {
    return {
        ai_status: tool({
            description:
                'See which AI you run on right now (connection, provider, model), the default of the workspace, every AI provider connected to it, and what is left on each: the Rerun credit, and for a Claude, Codex or OpenCode subscription the percentage used of each limit window with when it resets. Call it when the user asks which AI or model you use, what they can switch to, how much credit or quota is left, or why you stopped on a limit. API keys carry no quota here, only whether they work. A subscription with no reading yet has planLimits null: say it is unknown, never guess a figure. State the credit in credits, never in dollars. Read-only: to switch model, the user picks it in your settings.',
            inputSchema: z.object({}),
            execute: async () => {
                const connections = await listConnections()
                // Deliberately before the wait, unlike the connections list: the question is about
                // the quota, so the coworker waits (capped) for the reading it starts here.
                refreshStaleCodexPlanLimits(connections)
                refreshStaleOpencodePlanLimits(connections)
                const [, boxDefault, rerunCredit, answering] = await Promise.all([awaitPendingPlanLimits(connections), readBoxDefault(), readRerunCredit(ctx), answeringModel(ctx.provider, ctx.model)])
                const current = ctx.agent.resolved.connection
                return {
                    current: {
                        connectionId: current?.id ?? null,
                        connectionName: current?.config.name ?? null,
                        provider: PROVIDER_LABELS[ctx.provider],
                        model: ctx.model,
                        ...(answering !== ctx.model ? { answeringModel: answering } : {}),
                    },
                    workspaceDefault: boxDefault,
                    connections: connections.map(describeConnection),
                    rerunCredit,
                }
            },
        }),
    }
}
