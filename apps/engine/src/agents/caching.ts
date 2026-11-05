import type { ModelMessage, streamText } from 'ai'
import type { Provider } from '@rerun/contracts'
import { CLI_PROVIDERS } from './types.js'
import { behaviourOf } from './opencode.js'
import { systemPromptText, type SystemPrompt } from './systemPrompt.js'

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>
type SystemMessage = Extract<ModelMessage, { role: 'system' }>

// An hour rather than the default five minutes: a user who answers between the two would otherwise
// find the whole conversation gone from the cache, and the longer write only costs on the delta.
const ephemeral: ProviderOptions = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } }

// `model` only matters on OpenCode, whose caching is the one of the format the model is served on.
type CachingInput = { system: SystemPrompt; messages: ModelMessage[]; sessionId: string; model?: string }
type CachingOutput = { system?: string | SystemMessage[]; messages: ModelMessage[]; providerOptions?: ProviderOptions }

function systemMessages(system: SystemPrompt, providerOptions?: ProviderOptions): SystemMessage[] {
    return [system.stable, system.volatile].filter(Boolean).map(content => (providerOptions ? { role: 'system', content, providerOptions } : { role: 'system', content }))
}

/**
 * The breakpoint of the tail moves with it: a step reads what the step before it wrote only when the
 * marker sits on the last message of the request, the latest tool result included. The last message
 * is never an assistant one, so a thinking block never carries it.
 */
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

    // Two system messages on the OpenAI chat format: the hub (for `rerun`) and `cacheBreakpointsFetch`
    // (for an Anthropic model on the user's OpenRouter key) mark each one on the way out. The cache
    // key routes every request of a session to the same OpenAI cache, and OpenRouter reads it as its
    // sticky routing key when no `session_id` is given.
    if (provider === 'openai' || provider === 'openrouter') return { system: systemMessages(system), messages, providerOptions: { openai: { promptCacheKey: sessionId } } }
    if (provider === 'rerun') return { system: systemMessages(system), messages }

    // The two CLIs take the prompt through their own settings (`systemPrompt` on Claude,
    // `baseInstructions` on Codex, see `resolveModel`): a `system` here would reach the model a
    // second time, folded into the first user turn.
    if (CLI_PROVIDERS.has(provider)) return { messages }

    return { system: systemPromptText(system), messages }
}
