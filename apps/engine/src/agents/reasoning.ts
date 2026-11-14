import type { streamText } from 'ai'
import type { Provider } from '@rerun/contracts'
import { opencodeModel } from '../connections/opencode-catalog.js'
import { behaviourOf } from './opencode.js'

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

const REASONING_OPTIONS: Partial<Record<Provider, ProviderOptions>> = {
    anthropic: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } },
    openai: { openai: { reasoningSummary: 'auto' } },
    google: { google: { thinkingConfig: { includeThoughts: true } } },
}

export function reasoningProviderOptions(provider: Provider, model = ''): ProviderOptions | undefined {
    if (provider !== 'opencode') return REASONING_OPTIONS[provider]
    if (!opencodeModel(model)?.reasoning) return undefined
    return REASONING_OPTIONS[behaviourOf(provider, model)]
}

export function mergeProviderOptions(base: ProviderOptions | undefined, extra: ProviderOptions | undefined): ProviderOptions | undefined {
    if (!base) return extra
    if (!extra) return base
    const merged: ProviderOptions = { ...base }
    for (const [provider, options] of Object.entries(extra)) {
        merged[provider] = { ...merged[provider], ...options }
    }
    return merged
}
