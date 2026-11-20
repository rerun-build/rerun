import { z } from 'zod'
import type { Provider } from './agent.js'

// How long a model thinks before it answers. No level at all (null) leaves the provider's own
// default, and the request exactly as it was before the setting existed.
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS)
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>

// Haiku 4.5 answers 400 to an effort; every later Claude model takes low, medium and high.
const claudeTakesEffort = (model: string) => !/haiku-4[-.]5/.test(model)

// Whether a level can be asked of this model on this connection. The Rerun tiers set their own on
// the hub, OpenCode and custom endpoints serve models nobody vouches for: none of them gets one.
export function acceptsReasoningEffort(provider: Provider | null | undefined, model: string | null | undefined): boolean {
    if (!provider || !model) return false
    switch (provider) {
        case 'claude':
        case 'anthropic':
            return claudeTakesEffort(model)
        case 'codex':
            return true
        case 'openai':
            return /^gpt-[56]/.test(model)
        case 'google':
            return model.startsWith('gemini-')
        case 'openrouter':
            return (model.startsWith('anthropic/') && claudeTakesEffort(model)) || model.startsWith('openai/') || model.startsWith('google/')
        default:
            return false
    }
}
