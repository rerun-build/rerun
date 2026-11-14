import type { ModelMessage, streamText } from 'ai'
import type { Provider } from '@rerun/contracts'
import { CLI_PROVIDERS } from './types.js'
import { behaviourOf } from './opencode.js'
import { systemPromptText, type SystemPrompt } from './systemPrompt.js'

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>
type SystemMessage = Extract<ModelMessage, { role: 'system' }>

const ephemeral: ProviderOptions = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } }

type CachingInput = { system: SystemPrompt; messages: ModelMessage[]; sessionId: string; model?: string }
type CachingOutput = { system?: string | SystemMessage[]; messages: ModelMessage[]; providerOptions?: ProviderOptions }

function systemMessages(system: SystemPrompt, providerOptions?: ProviderOptions): SystemMessage[] {
    return [system.stable, system.volatile].filter(Boolean).map(content => (providerOptions ? { role: 'system', content, providerOptions } : { role: 'system', content }))
}

export function withTailBreakpoint(messages: ModelMessage[]): ModelMessage[] {
    const tail = messages.length - 1
    return messages.map((message, i) => {
        const { anthropic, ...rest } = message.providerOptions ?? {}
        const options = i === tail ? { ...rest, ...ephemeral } : Object.keys(rest).length ? rest : undefined
        return options ? { ...message, providerOptions: options } : anthropic ? { ...message, providerOptions: undefined } : message
    })
}

export function applyCaching(runProvider: Provider, { system, messages, sessionId, model = '' }: CachingInput): CachingOutput {
    const provider = behaviourOf(runProvider, model)
    if (provider === 'anthropic') return { system: systemMessages(system, ephemeral), messages: withTailBreakpoint(messages) }

    if (provider === 'openai' || provider === 'openrouter') return { system: systemMessages(system), messages, providerOptions: { openai: { promptCacheKey: sessionId } } }
    if (provider === 'rerun') return { system: systemMessages(system), messages }

    if (CLI_PROVIDERS.has(provider)) return { messages }

    return { system: systemPromptText(system), messages }
}
