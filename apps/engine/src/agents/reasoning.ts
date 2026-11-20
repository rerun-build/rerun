import type { streamText } from 'ai'
import { acceptsReasoningEffort, type Provider, type ReasoningEffort } from '@rerun/contracts'
import { opencodeModel } from '../connections/opencode-catalog.js'
import { behaviourOf } from './opencode.js'
import type { ModelOverride } from './providers.js'
import type { LoadedAgent } from './types.js'

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

// Every provider that can show its work is asked to show it, and the model decides when there is
// anything to show: `adaptive` on Anthropic, and on the others a summary of reasoning the model
// already produces and already bills for. `claude` and `codex` drive their CLI through
// `defaultSettings` instead, and `rerun` / `openrouter` ask for it in the request body
// (see openrouter-reasoning.ts) because the OpenAI chat wire format has no field for it.
const REASONING_OPTIONS: Partial<Record<Provider, ProviderOptions>> = {
    anthropic: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } },
    openai: { openai: { reasoningSummary: 'auto' } },
    google: { google: { thinkingConfig: { includeThoughts: true } } },
}

// An OpenCode model is asked the way its format asks, and only when OpenCode says it reasons: the
// chat format has no field for it, the model reasons or not on its own.
export function reasoningProviderOptions(provider: Provider, model = ''): ProviderOptions | undefined {
    if (provider !== 'opencode') return REASONING_OPTIONS[provider]
    if (!opencodeModel(model)?.reasoning) return undefined
    return REASONING_OPTIONS[behaviourOf(provider, model)]
}

// One level deep on purpose: `openai` already carries the `promptCacheKey` that applyCaching put
// there, and a plain spread of the two objects would drop it.
export function mergeProviderOptions(base: ProviderOptions | undefined, extra: ProviderOptions | undefined): ProviderOptions | undefined {
    if (!base) return extra
    if (!extra) return base
    const merged: ProviderOptions = { ...base }
    for (const [provider, options] of Object.entries(extra)) {
        merged[provider] = { ...merged[provider], ...options }
    }
    return merged
}

// The effort a run asks for. The conversation's pick wins; without one, the agent's own effort goes
// with the model it was picked for, so a backup, a handover or a routine pinned to another model runs
// on that model's default. A model that takes no effort never gets one.
export function runEffort(agent: Pick<LoadedAgent, 'config'>, override: ModelOverride | undefined, provider: Provider, model: string): ReasoningEffort | null {
    const effort = override?.effort !== undefined ? override.effort : model === agent.config.model ? agent.config.effort : null
    return effort && acceptsReasoningEffort(provider, model) ? effort : null
}

// The effort in each API's own words. The CLIs and OpenRouter take theirs elsewhere (see
// `resolveModel`). `forceReasoning`: the OpenAI SDK only sends an effort to the models it knows to
// reason, a list the GPT-6 ids are not on yet. Google's object is whole because the merge is one
// level deep and would otherwise drop `includeThoughts`.
export function effortProviderOptions(provider: Provider, effort: ReasoningEffort | null): ProviderOptions | undefined {
    if (!effort) return undefined
    switch (provider) {
        case 'anthropic':
            return { anthropic: { effort } }
        case 'openai':
            return { openai: { reasoningEffort: effort, forceReasoning: true } }
        case 'google':
            return { google: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } } }
        case 'codex':
            return { 'codex-app-server': { effort } }
        default:
            return undefined
    }
}
