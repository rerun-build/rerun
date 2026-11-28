import type { MessageUsageMetadata, Usage } from '@rerun/contracts'

export type ContextStats = { used: number; max: number | undefined; usage: Usage; model: string | undefined; provider: string | undefined }

type UsageSeed = { usage: Usage; provider: string | null }
type MessageLike = { role: string; metadata?: unknown }

// A CLI provider runs its whole turn as one step, so its tokens add up every model call of the turn.
const WHOLE_TURN_PROVIDERS = new Set(['claude', 'codex'])

// The `context` block, when the engine captured one, is the real window occupancy. Without it,
// input tokens approximate occupancy for API providers, but for claude and codex they are the
// whole turn's cumulative bill (cache reads counted once per model call), so the gauge hides
// rather than lie: a run an older engine finished has no block.
function statsFrom(usage: Usage, provider: string | undefined, model: string | undefined): ContextStats | null {
    if (usage.context) return { used: usage.context.usedTokens, max: usage.context.maxTokens, usage, model, provider }
    if (provider && WHOLE_TURN_PROVIDERS.has(provider)) return null
    const used = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    return { used, max: undefined, usage, model, provider }
}

// Latest assistant usage drives the context gauge. A reopened conversation has none on its
// messages, so the usage of its last finished run stands in until a turn streams.
export function contextStatsOf(messages: readonly MessageLike[], seed: UsageSeed | null, fallbackModel: string | undefined): ContextStats | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message.role !== 'assistant') continue
        const meta = message.metadata as MessageUsageMetadata | undefined
        if (!meta?.usage) continue
        return statsFrom(meta.usage, meta.provider, meta.model ?? fallbackModel)
    }
    return seed ? statsFrom(seed.usage, seed.provider ?? undefined, fallbackModel) : null
}
