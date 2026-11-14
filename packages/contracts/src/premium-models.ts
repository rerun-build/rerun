import { z } from 'zod'
import type { Provider } from './agent.js'

const PREMIUM_MODEL = /opus|fable|astra/i

export function isPremiumModel(model: string): boolean {
    return PREMIUM_MODEL.test(model)
}

const TRIAL_CLAUDE_MODEL: Partial<Record<Provider, string>> = {
    claude: 'claude-sonnet-5-5',
    anthropic: 'claude-sonnet-5-5',
    openrouter: 'anthropic/claude-sonnet-5.5',
    opencode: 'console/claude-sonnet-5-5',
}

export function trialModelFor(provider: Provider, model: string): string {
    if (provider === 'custom' || !isPremiumModel(model)) return model
    if (/astra/i.test(model)) return model.replace(/astra/i, 'sol')
    return TRIAL_CLAUDE_MODEL[provider] ?? model
}

export const boxPlanSchema = z.object({ premiumModels: z.boolean() })
export type BoxPlan = z.infer<typeof boxPlanSchema>
