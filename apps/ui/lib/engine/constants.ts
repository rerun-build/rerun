import { RERUN_MODELS, type MoldwrightTier } from '@moldwright/contracts'

export const ENGINE_DEFAULT_PORT = 3000

export const ENGINE_PROVIDERS: { id: string; label: string }[] = [
    { id: 'rerun', label: 'Moldwright' },
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'google', label: 'Google' },
    { id: 'openrouter', label: 'OpenRouter' },
]

export const RERUN_DEMO_MODEL_IDS = [RERUN_MODELS.balanced, RERUN_MODELS.fast, RERUN_MODELS.smart] as const

export const RERUN_UPSTREAM_MODELS: Record<MoldwrightTier, string> = {
    fast: 'openai/gpt-6-luna',
    balanced: 'anthropic/claude-haiku-5.5',
    smart: 'openai/gpt-6-sol',
}

export function servedMoldwrightTier(asked: MoldwrightTier, smartAllowed: boolean): MoldwrightTier {
    return asked === 'smart' && !smartAllowed ? 'balanced' : asked
}

export const RERUN_TIER_REASONING: Partial<Record<MoldwrightTier, { effort: 'low' }>> = {
    fast: { effort: 'low' },
}

export { SELF_IMPROVEMENT_KEYS as ENGINE_SELF_IMPROVEMENT_KEYS, TOOL_KEYS as ENGINE_TOOL_KEYS } from '@moldwright/contracts'
