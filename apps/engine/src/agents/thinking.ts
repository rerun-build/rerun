import type { Provider, AgentConfig } from '@rerun/contracts'
import type { streamText } from 'ai'
import { REASONING_REQUEST } from './openrouter-reasoning.js'
import { reasoningProviderOptions } from './reasoning.js'

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>
export type ThinkingLevel = NonNullable<AgentConfig['thinkingLevel']>

export type ThinkingSettings = {
    claudeThinking?: { type: 'adaptive'; display: 'summarized'; effort?: ThinkingLevel }
    providerOptions?: ProviderOptions
    openrouterReasoning?: { enabled: boolean; effort?: ThinkingLevel }
}

export const CLAUDE_DEFAULT_THINKING = { type: 'adaptive', display: 'summarized' } as const

export function thinkingSettingsFor(provider: Provider, model: string, level: ThinkingLevel | null | undefined): ThinkingSettings {
    const base = (): ThinkingSettings => {
        if (provider === 'claude') return { claudeThinking: CLAUDE_DEFAULT_THINKING }
        if (provider === 'rerun' || provider === 'openrouter') return { openrouterReasoning: REASONING_REQUEST }
        return { providerOptions: reasoningProviderOptions(provider, model) }
    }
    if (!level) return base()
    switch (provider) {
        case 'claude':
            return { claudeThinking: { ...CLAUDE_DEFAULT_THINKING, effort: level } }
        case 'anthropic':
            return { providerOptions: { anthropic: { thinking: CLAUDE_DEFAULT_THINKING, effort: level } } }
        case 'openai':
            return { providerOptions: { openai: { reasoningSummary: 'auto', reasoningEffort: level } } }
        case 'google':
            return { providerOptions: { google: { thinkingConfig: { includeThoughts: true, thinkingLevel: level } } } }
        case 'rerun':
        case 'openrouter':
            return { openrouterReasoning: { ...REASONING_REQUEST, effort: level } }
        default:
            return base()
    }
}
