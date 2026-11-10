import { RERUN_MODEL, type Provider } from './agent.js'
import { OPENCODE_SNAPSHOT } from './opencode-snapshot.js'

// What each model accepts when reached through its own API.
export const MODEL_CONTEXT_WINDOW: Record<string, number> = {
    'claude-fable-5-2': 1_000_000,
    'claude-fable-5-1': 1_000_000,
    'claude-fable-5': 1_000_000,
    'claude-opus-5-5': 1_000_000,
    'claude-opus-5': 1_000_000,
    'claude-opus-4-8': 1_000_000,
    'claude-opus-4-7': 1_000_000,
    'claude-sonnet-5-5': 1_000_000,
    'claude-sonnet-5': 1_000_000,
    'claude-sonnet-4-6': 1_000_000,
    'claude-haiku-5-5': 1_000_000,
    'claude-haiku-4-5': 200_000,
    'claude-haiku-4-5-20251001': 200_000,
    // Claude Code's `[1m]` variants, and the aliases it accepted before the catalog named models
    // outright. Both still appear on connections curated by an older build.
    'claude-opus-4-8[1m]': 1_000_000,
    'claude-opus-4-7[1m]': 1_000_000,
    'claude-opus-4-6[1m]': 1_000_000,
    'claude-sonnet-5[1m]': 1_000_000,
    'claude-sonnet-4-6[1m]': 1_000_000,
    fable: 1_000_000,
    opus: 1_000_000,
    sonnet: 1_000_000,
    haiku: 200_000,
    'gpt-6-astra': 922_000,
    'gpt-6.1-sol': 922_000,
    'gpt-6.1-terra': 922_000,
    'gpt-6-sol': 922_000,
    'gpt-6-luna': 922_000,
    'gpt-5.6-sol': 872_000,
    'gpt-5.6-terra': 272_000,
    'gpt-5.6-luna': 272_000,
    'gpt-5.5': 1_000_000,
    'gpt-5.4': 400_000,
    'gpt-5.4-mini': 400_000,
    'gpt-4o': 128_000,
    'gpt-4o-mini': 128_000,
    'gemini-4-argon': 1_000_000,
    'gemini-3.8-flash': 1_000_000,
    'gemini-3.6-flash': 1_000_000,
    'gemini-3.5-flash': 1_000_000,
    'gemini-3.5-flash-lite': 1_000_000,
    'gemini-3.1-pro-preview': 1_000_000,
    'gemini-3.1-flash-lite': 1_000_000,
    'gemini-3-flash-preview': 1_000_000,
    'anthropic/claude-fable-5.2': 1_000_000,
    'anthropic/claude-fable-5.1': 1_000_000,
    'anthropic/claude-opus-5.5': 1_000_000,
    'anthropic/claude-opus-5': 1_000_000,
    'anthropic/claude-opus-4.8': 1_000_000,
    'anthropic/claude-sonnet-5': 1_000_000,
    'anthropic/claude-sonnet-5.5': 1_000_000,
    'anthropic/claude-haiku-5.5': 1_000_000,
    'anthropic/claude-sonnet-4.6': 1_000_000,
    'openai/gpt-6-astra': 922_000,
    'openai/gpt-6.1-sol': 922_000,
    'openai/gpt-6-sol': 922_000,
    'openai/gpt-6-luna': 922_000,
    'openai/gpt-5.6-sol': 872_000,
    'openai/gpt-5.5': 1_000_000,
    'google/gemini-4-argon': 1_000_000,
    'google/gemini-3.8-flash': 1_000_000,
    'google/gemini-3.1-pro-preview': 1_000_000,
    'google/gemini-3-flash-preview': 1_000_000,
    'x-ai/grok-4.7': 500_000,
    'x-ai/grok-4.6': 500_000,
    'xiaomi/mimo-v2.6-pro': 1_000_000,
    'xiaomi/mimo-v2.5-pro': 1_000_000,
    'xiaomi/mimo-v2.5': 1_000_000,
    'minimax/minimax-m3.1-flash': 1_000_000,
    'minimax/minimax-m3': 1_000_000,
    'deepseek/deepseek-v4-pro': 1_000_000,
    'deepseek/deepseek-v4-flash': 1_000_000,
    // A Rerun tier's window has to stay at or under the window of the model the hub resolves it to
    // (`RERUN_UPSTREAM_MODELS` in apps/ui): the hub can swap that model without the boxes knowing.
    'rerun-fast': 922_000,
    'rerun-max': 922_000,
    'rerun-smart': 922_000,
    'qwen/qwen3.8-flash': 1_000_000,
    // What the boxes provisioned before the `rerun-max` alias still name. Dropping it would not
    // fail loudly: an id absent from here leaves compaction without a threshold, so it never runs.
    'qwen/qwen3.7-max': 1_000_000,
    'qwen/qwen3.7-plus': 1_000_000,
    'moonshotai/kimi-k3.1-pro': 1_000_000,
    'moonshotai/kimi-k3': 1_000_000,
    'moonshotai/kimi-k2.6': 256_000,
    // `go/…` and `console/…` collide with no other id. A model OpenCode publishes after this snapshot
    // is read off the engine's live catalog instead.
    ...Object.fromEntries(OPENCODE_SNAPSHOT.map(model => [model.id, model.contextWindow])),
}

// A CLI provider does not serve the model's own window: it serves whatever its client allows on
// the signed-in plan, which is far smaller. Codex caps every model it serves at 272k and fills
// only 95% of it, whatever the model's API limit. Read from `context_window` in its own
// models_cache.json (client 0.147.0, fetched 2026-08-24). Getting this wrong is not cosmetic: the
// gap is what decides whether compaction runs, and a window declared 4x too large means it never
// does, so a session grows until the CLI stops answering with no error to show for it.
//
// Claude serves 200k on a subscription whatever the model's API window, and 1M only on the ids
// that ask for it. The engine switches the CLI's own compaction off (one compaction, Rerun's), so
// this budget is the only thing that keeps a session inside the window.
const CLI_CONTEXT_WINDOW: Partial<Record<Provider, (id: string) => number>> = {
    codex: () => 272_000,
    claude: id => (id.endsWith('[1m]') ? 1_000_000 : 200_000),
}

// `provider` is widened to string because the chat gauge reads it back off message metadata,
// where it survives as a plain string.
export function modelContextWindow(id: string | null | undefined, provider?: string | null): number | undefined {
    if (!id) return undefined
    const cli = provider ? CLI_CONTEXT_WINDOW[provider as Provider]?.(id) : undefined
    const api = MODEL_CONTEXT_WINDOW[id]
    if (cli === undefined) return api
    return api === undefined ? cli : Math.min(cli, api)
}

// How a model id is written for a human. It lives here rather than in the UI catalog because the
// iOS app names the same models and cannot import from `apps/ui`; the catalog builds its labels
// from this map, so there is one spelling of "GPT-5.6 Sol" in the repo. Ids absent from here are
// custom models a user typed on an OpenRouter connection: they show as they were entered.
export const MODEL_LABEL: Record<string, string> = {
    'rerun-fast': 'Fast',
    'rerun-max': 'Rerun',
    'rerun-smart': 'Smart',
    // What the boxes provisioned before the `rerun-max` alias still name: without this line their
    // model picker reads the raw OpenRouter id.
    'qwen/qwen3.7-max': 'Rerun',
    'claude-fable-5-2': 'Fable 5.2',
    'claude-fable-5-1': 'Fable 5.1',
    'claude-fable-5': 'Fable 5',
    'claude-opus-5-5': 'Opus 5.5',
    'claude-opus-5': 'Opus 5',
    'claude-opus-4-8': 'Opus 4.8',
    'claude-sonnet-5-5': 'Sonnet 5.5',
    'claude-sonnet-5': 'Sonnet 5',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-haiku-5-5': 'Haiku 5.5',
    'claude-haiku-4-5': 'Haiku 4.5',
    'claude-haiku-4-5-20251001': 'Haiku 4.5',
    // The `[1m]` variants are a distinct pick in Claude Code's own list, so they keep the marker:
    // dropping it would put two identically named rows in the same section.
    'claude-opus-4-8[1m]': 'Opus 4.8 1M',
    'claude-opus-4-7[1m]': 'Opus 4.7 1M',
    'claude-opus-4-6[1m]': 'Opus 4.6 1M',
    'claude-sonnet-5[1m]': 'Sonnet 5 1M',
    'claude-sonnet-4-6[1m]': 'Sonnet 4.6 1M',
    'gpt-6-astra': 'GPT-6 Astra',
    'gpt-6.1-sol': 'GPT-6.1 Sol',
    'gpt-6.1-terra': 'GPT-6.1 Terra',
    'gpt-6-sol': 'GPT-6 Sol',
    'gpt-6-luna': 'GPT-6 Luna',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.4-mini': 'GPT-5.4 mini',
    'gemini-4-argon': 'Gemini 4 Argon',
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
    'anthropic/claude-fable-5.2': 'Fable 5.2',
    'anthropic/claude-fable-5.1': 'Fable 5.1',
    'anthropic/claude-opus-5.5': 'Opus 5.5',
    'anthropic/claude-opus-5': 'Opus 5',
    'anthropic/claude-sonnet-5': 'Sonnet 5',
    'anthropic/claude-sonnet-5.5': 'Sonnet 5.5',
    'openai/gpt-6-astra': 'GPT-6 Astra',
    'openai/gpt-6.1-sol': 'GPT-6.1 Sol',
    'openai/gpt-6-sol': 'GPT-6 Sol',
    'openai/gpt-6-luna': 'GPT-6 Luna',
    'openai/gpt-5.6-sol': 'GPT-5.6 Sol',
    'google/gemini-4-argon': 'Gemini 4 Argon',
    'google/gemini-3.8-flash': 'Gemini 3.8 Flash',
    'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'x-ai/grok-4.7': 'Grok 4.7',
    'x-ai/grok-4.6': 'Grok 4.6',
    'moonshotai/kimi-k3.1-pro': 'Kimi K3.1 Pro',
    'moonshotai/kimi-k3': 'Kimi K3',
    'deepseek/deepseek-v4-pro': 'DeepSeek V4 Pro',
    'xiaomi/mimo-v2.6-pro': 'MiMo V2.6 Pro',
    'xiaomi/mimo-v2.5-pro': 'MiMo V2.5 Pro',
    'qwen/qwen3.8-flash': 'Qwen3.8 Flash',
    'minimax/minimax-m3.1-flash': 'MiniMax M3.1 Flash',
    'minimax/minimax-m3': 'MiniMax M3',
    ...Object.fromEntries(OPENCODE_SNAPSHOT.map(model => [model.id, model.label])),
}

// Friendly label for a model id; falls back to the raw id for custom/unknown models.
export function modelLabel(id: string): string {
    return MODEL_LABEL[id] ?? id
}

// The id a model was curated under before it was renamed. A box whose connection was written by an
// older build still carries the old spelling, which would list right next to the current one under
// the same label: two "Rerun" rows, one of them a stranger to the catalog.
export const MODEL_ALIAS: Record<string, string> = {
    'qwen/qwen3.7-max': RERUN_MODEL,
}

export function canonicalModelId(id: string): string {
    return MODEL_ALIAS[id] ?? id
}

// A stored model list read under today's ids. Deduplicated: a list carrying both spellings of the
// same model collapses to one entry.
export function canonicalModelIds(ids: string[]): string[] {
    return [...new Set(ids.map(canonicalModelId))]
}
