// Curated model catalog for the in-chat model selector.
//
// rerun-engine accepts any `${provider}:${model}` string (see engine providers.ts),
// so this list is purely a UI convenience: it gives friendly labels and groups the
// models a user is likely to pick. The `keyName` ties each provider group to the
// per-agent API key that must be set for its models to be "available". Edit freely to
// add/remove models.

import { DEFAULT_CONNECTION_MODELS, MODEL_LABEL, OPENCODE_SNAPSHOT, modelLabel } from '@rerun/contracts'

import { RERUN_DEMO_MODEL_IDS } from './constants'

export { modelContextWindow, modelLabel } from '@rerun/contracts'

// `power` is a 1-6 capability rating on a single global scale (comparable across
// providers), surfaced as ascending signal-style bars in the model picker. Optional:
// custom/unknown models have none and show no bars.
// Model context windows are not stored here: the authoritative values live in
// `@rerun/contracts` (MODEL_CONTEXT_WINDOW) so the engine can read them too. Use
// `modelContextWindow(id)` for the in-chat context gauge.
export type CatalogModel = { id: string; label: string; power?: number }

// The spelling of every label lives in `@rerun/contracts` (MODEL_LABEL) so the iOS app, which
// cannot import from here, names the same models the same way.
const model = (id: string, power?: number): CatalogModel => ({ id, label: modelLabel(id), power })

export type ProviderSection = 'free' | 'subscription' | 'api'
export type CatalogProvider = { provider: string; label: string; keyName: string; section: ProviderSection; apiKeyUrl?: string; models: CatalogModel[] }

// The `rerun` provider has no per-agent key (keyName: ''): requests are routed
// through the hub which holds the shared OpenRouter key. Listed first so it is the
// default a new user sees — try a model without any setup.
const RERUN_DEMO_MODEL_POWER: Record<(typeof RERUN_DEMO_MODEL_IDS)[number], number> = {
    'rerun-max': 4,
    'rerun-fast': 2,
    'rerun-smart': 5,
}

export const ENGINE_MODEL_CATALOG: CatalogProvider[] = [
    {
        provider: 'rerun',
        label: 'Rerun',
        keyName: '',
        section: 'free',
        models: RERUN_DEMO_MODEL_IDS.map(id => model(id, RERUN_DEMO_MODEL_POWER[id])),
    },
    {
        provider: 'anthropic',
        label: 'Anthropic',
        keyName: 'ANTHROPIC_API_KEY',
        section: 'api',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        models: [
            model('claude-fable-5-1', 6),
            model('claude-fable-5', 6),
            model('claude-opus-5-5', 5),
            model('claude-opus-5', 5),
            model('claude-opus-4-8', 4),
            model('claude-sonnet-5-5', 4),
            model('claude-sonnet-5', 4),
            model('claude-sonnet-4-6', 3),
            model('claude-haiku-5-5', 3),
            model('claude-haiku-4-5-20251001', 2),
        ],
    },
    {
        provider: 'claude',
        label: 'Claude (Subscription)',
        keyName: 'CLAUDE_CODE_OAUTH_TOKEN',
        section: 'subscription',
        apiKeyUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
        // Claude Code's own picker, id for id. `[1m]` is how the CLI names the 1M-context variant of
        // a model whose default window is smaller; Fable, Opus 5/5.5, Sonnet 5.5 and Haiku 5.5 are 1M
        // natively and take none. Haiku 5.5 needs Claude Code 2.1.293: the binary is the one the Agent SDK
        // ships inside the engine release.
        models: [
            model('claude-opus-5-5', 5),
            model('claude-fable-5-1', 6),
            model('claude-fable-5', 6),
            model('claude-opus-5', 5),
            model('claude-opus-4-8[1m]', 4),
            model('claude-opus-4-7[1m]', 4),
            model('claude-opus-4-6[1m]', 3),
            model('claude-sonnet-5-5', 4),
            model('claude-sonnet-5[1m]', 4),
            model('claude-sonnet-4-6[1m]', 3),
            model('claude-sonnet-4-6', 3),
            model('claude-haiku-5-5', 3),
            model('claude-haiku-4-5', 2),
        ],
    },
    {
        provider: 'codex',
        label: 'Codex (Subscription)',
        keyName: 'CODEX_OAUTH_TOKEN',
        section: 'subscription',
        apiKeyUrl: 'https://developers.openai.com/codex/cli',
        // `gpt-6.1-sol` and `gpt-6.1-terra` need Codex CLI 0.159.1. A model the box's Codex does not
        // list for the account is locked (`cliModels`), whether the binary or the plan lacks it.
        // `gpt-5.5` left Codex for ChatGPT sign-ins on 2026-10-14. GPT-6.1 Sol is still rolling out
        // plan by plan, so `gpt-6-sol` stays first: the backend can answer 400 "not supported when
        // using Codex with a ChatGPT account" on a plan that does not have it yet.
        models: [
            model('gpt-6-sol', 5),
            model('gpt-6.1-sol', 5),
            model('gpt-6-astra', 6),
            model('gpt-6.1-terra', 4),
            model('gpt-6-luna', 3),
            model('gpt-5.6-sol', 5),
            model('gpt-5.6-terra', 4),
            model('gpt-5.6-luna', 2),
        ],
    },
    {
        provider: 'openai',
        label: 'OpenAI',
        keyName: 'OPENAI_API_KEY',
        section: 'api',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        models: [
            model('gpt-6-astra', 6),
            model('gpt-6.1-sol', 5),
            model('gpt-6-sol', 5),
            model('gpt-6.1-terra', 4),
            model('gpt-6-luna', 3),
            model('gpt-5.6-sol', 5),
            model('gpt-5.5', 4),
            model('gpt-5.4', 3),
            model('gpt-5.4-mini', 2),
        ],
    },
    {
        provider: 'google',
        label: 'Google',
        keyName: 'GOOGLE_GENERATIVE_AI_API_KEY',
        section: 'api',
        apiKeyUrl: 'https://aistudio.google.com/apikey',
        models: [
            model('gemini-4-argon', 5),
            model('gemini-3.8-flash', 4),
            model('gemini-3.6-flash', 3),
            model('gemini-3.5-flash-lite', 2),
        ],
    },
    {
        provider: 'openrouter',
        label: 'OpenRouter',
        keyName: 'OPENROUTER_API_KEY',
        section: 'api',
        apiKeyUrl: 'https://openrouter.ai/keys',
        models: [
            model('anthropic/claude-fable-5.1', 6),
            model('anthropic/claude-opus-5.5', 5),
            model('anthropic/claude-sonnet-5.5', 4),
            model('openai/gpt-6-astra', 6),
            model('openai/gpt-6.1-sol', 5),
            model('openai/gpt-6-sol', 5),
            model('openai/gpt-6-luna', 3),
            model('google/gemini-4-argon', 5),
            model('google/gemini-3.8-flash', 4),
            model('x-ai/grok-4.7', 4),
            model('moonshotai/kimi-k3.1-pro', 4),
            model('deepseek/deepseek-v4-pro', 3),
            model('xiaomi/mimo-v2.6-pro', 3),
            model('qwen/qwen3.8-flash', 2),
            model('minimax/minimax-m3.1-flash', 2),
        ],
    },
    {
        // Read from the snapshot OpenCode published when this build was cut; a connection reads the
        // box's live catalog instead (`providerModels`). The Go models first, the default leading,
        // then the Console ones. No power bars: OpenCode lists dozens of models we never rated.
        provider: 'opencode',
        label: 'OpenCode',
        keyName: 'OPENCODE_API_KEY',
        section: 'subscription',
        apiKeyUrl: 'https://opencode.ai/auth',
        models: [...DEFAULT_CONNECTION_MODELS.opencode, ...OPENCODE_SNAPSHOT.filter(m => m.plan === 'console').map(m => m.id)].map(id => model(id)),
    },
]

// Flat lookup of model id -> provider display label (e.g. `rerun-max` -> `Rerun`), built once.
const MODEL_PROVIDER_LABEL: Record<string, string> = Object.fromEntries(ENGINE_MODEL_CATALOG.flatMap(p => p.models.map(m => [m.id, p.label])))

// Fully-qualified label for logs: provider + model (e.g. `OpenAI GPT-5.5`). Falls back to the
// bare label, then the raw id, for custom/unknown models. A label that already is the provider's
// name (`Rerun`) is not doubled.
export function modelLogLabel(id: string | null | undefined): string {
    if (!id) return ''
    const label = MODEL_LABEL[id]
    if (!label) return id
    const provider = MODEL_PROVIDER_LABEL[id]
    return provider && provider !== label ? `${provider} ${label}` : label
}

// Flat lookup of model id -> power rating, built once.
const MODEL_POWER: Record<string, number> = Object.fromEntries(ENGINE_MODEL_CATALOG.flatMap(p => p.models.flatMap(m => (m.power ? [[m.id, m.power]] : []))))

// Power rating (1-6) for a model id; undefined for custom/unknown models (no bars shown).
export function modelPower(id: string | null | undefined): number | undefined {
    return id ? MODEL_POWER[id] : undefined
}

// Flat lookup of model id -> provider id, built once. Ids do collide: a subscription group and its
// API twin serve the same model under the same id (`gpt-6-astra` on codex and openai,
// `claude-opus-5` on claude and anthropic), so the last group listed wins. That is harmless
// precisely because the two sides of such a pair are the same vendor: same label, same icon. The
// per-connection pickers never read this map, they read `connection.models`.
const MODEL_PROVIDER: Record<string, string> = Object.fromEntries(ENGINE_MODEL_CATALOG.flatMap(p => p.models.map(m => [m.id, p.provider])))

// Provider id for a model id; undefined for custom/unknown models (no icon shown).
export function modelProvider(id: string | null | undefined): string | undefined {
    return id ? MODEL_PROVIDER[id] : undefined
}

// Every model id known to the catalog.
export const ALL_CATALOG_MODEL_IDS: string[] = ENGINE_MODEL_CATALOG.flatMap(p => p.models.map(m => m.id))

const CATALOG_BY_PROVIDER: Record<string, CatalogProvider> = Object.fromEntries(ENGINE_MODEL_CATALOG.map(p => [p.provider, p]))

// The display side of a provider: labels, power ratings, where to get a key. A provider the
// catalog has never heard of still answers, with an empty model list, so a connection created
// against a newer engine renders instead of crashing.
export function catalogFor(provider: string): CatalogProvider {
    return CATALOG_BY_PROVIDER[provider] ?? { provider, label: provider, keyName: '', section: 'api', models: [] }
}
