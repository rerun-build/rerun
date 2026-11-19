import type { streamText } from 'ai'
import type { Provider } from '@moldwright/contracts'
import { opencodeModel } from '../connections/opencode-catalog.js'
import { logger } from '../lib/logger.js'
import { behaviourOf } from './opencode.js'
import { thinkingSettingsFor, type ThinkingLevel } from './thinking.js'

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

export const REASONING_OPTIONS: Partial<Record<Provider, ProviderOptions>> = {
    anthropic: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } },
    openai: { openai: { reasoningSummary: 'auto' } },
    google: { google: { thinkingConfig: { includeThoughts: true } } },
}

const LEVEL_UNSUPPORTED = new Set<string>()

export function reasoningProviderOptions(provider: Provider, model = '', level?: ThinkingLevel | null): ProviderOptions | undefined {
    const target = provider === 'opencode' ? behaviourOf(provider, model) : provider
    if (provider === 'opencode' && !opencodeModel(model)?.reasoning) return undefined
    if (level && (target === 'anthropic' || target === 'openai' || target === 'google')) return thinkingSettingsFor(target, model, level).providerOptions
    if (level && target !== 'claude' && target !== 'rerun' && target !== 'openrouter' && !LEVEL_UNSUPPORTED.has(provider)) {
        LEVEL_UNSUPPORTED.add(provider)
        logger.info({ provider }, 'thinking level ignored: provider cannot take it')
    }
    return REASONING_OPTIONS[target]
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
