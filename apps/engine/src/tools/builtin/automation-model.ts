import type { Provider } from '@rerun/contracts'
import { connectionsOfProvider } from '../../connections/resolve.js'
import type { RunContext } from '../../runtime/context.js'

export type PinnedModel = { connectionId: string | null; provider: Provider | null; model: string | null }

export async function pinnedModel(ctx: Pick<RunContext, 'provider' | 'agent'>, provider: Provider | undefined, model: string | undefined): Promise<PinnedModel | { refusal: string }> {
    if (!model) return { connectionId: null, provider: null, model: null }
    if (!provider || provider === ctx.provider) return { connectionId: ctx.agent.resolved.connection?.id ?? null, provider: ctx.provider, model }
    const match = (await connectionsOfProvider(provider))[0]
    if (!match) return { refusal: `No ${provider} connection is plugged into this box, so a task pinned to ${model} would fall back to your own model. Leave provider and model out so it follows you, or ask the user to connect ${provider} first.` }
    return { connectionId: match.id, provider, model }
}

export const PROVIDER_WITHOUT_MODEL = 'provider only goes with a model; nothing changed.'
