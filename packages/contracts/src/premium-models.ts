import { z } from 'zod'
import type { Provider } from './agent.js'

// The models a trial does not run: the whole Opus and Fable families, and GPT-6 Astra. They are the
// ones that empty a subscription in an afternoon. Matched by name so the CLI aliases (`opus`,
// `fable`), the `[1m]` variants and the OpenRouter spellings are caught without a list to maintain.
const PREMIUM_MODEL = /opus|fable|astra/i

export function isPremiumModel(model: string): boolean {
    return PREMIUM_MODEL.test(model)
}

// Sonnet 5.5 as each provider spells it. Only the providers that serve Opus or Fable need one.
const TRIAL_CLAUDE_MODEL: Partial<Record<Provider, string>> = {
    claude: 'claude-sonnet-5-5',
    anthropic: 'claude-sonnet-5-5',
    openrouter: 'anthropic/claude-sonnet-5.5',
    opencode: 'console/claude-sonnet-5-5',
}

// What a trial box runs in place of a premium model, one step down in the same family.
export function trialModelFor(provider: Provider, model: string): string {
    if (!isPremiumModel(model)) return model
    if (/astra/i.test(model)) return model.replace(/astra/i, 'sol')
    return TRIAL_CLAUDE_MODEL[provider] ?? model
}

// What the hub tells a box about its plan. A box that was never told runs everything: an engine
// that has not heard from the hub yet must not take Opus away from a paying workspace.
export const boxPlanSchema = z.object({ premiumModels: z.boolean() })
export type BoxPlan = z.infer<typeof boxPlanSchema>
