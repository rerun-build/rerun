import type { DelegatedUsage } from './context.js'

export const USAGE_KEYS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'totalTokens'] as const

export function plusDelegated<T extends Partial<Record<(typeof USAGE_KEYS)[number], number | undefined>>>(usage: T | undefined, delegated: DelegatedUsage | undefined): T | undefined {
    if (!delegated || USAGE_KEYS.every(key => delegated[key] === 0)) return usage
    const sum: Record<string, number> = { ...usage }
    for (const key of USAGE_KEYS) sum[key] = (usage?.[key] ?? 0) + delegated[key]
    return sum as T
}
