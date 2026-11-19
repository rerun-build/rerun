import { DEFAULT_CONNECTION_MODELS, MODEL_LABEL, OPENCODE_SNAPSHOT, isFreeOpencodeModel, modelLabel } from '@moldwright/contracts'

import { RERUN_DEMO_MODEL_IDS } from './constants'

export { modelContextWindow, modelLabel } from '@moldwright/contracts'

export type CatalogModel = { id: string; label: string; power?: number }

const model = (id: string, power?: number): CatalogModel => ({ id, label: modelLabel(id), power })

export type ProviderSection = 'free' | 'subscription' | 'api'
export type CatalogProvider = { provider: string; label: string; keyName: string; section: ProviderSection; apiKeyUrl?: string; models: CatalogModel[] }

const RERUN_DEMO_MODEL_POWER: Record<(typeof RERUN_DEMO_MODEL_IDS)[number], number> = {
    'rerun-max': 4,
    'rerun-fast': 2,
    'rerun-smart': 5,
}

export const ENGINE_MODEL_CATALOG: CatalogProvider[] = [
    {
        provider: 'rerun',
        label: 'Moldwright',
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
            model('claude-fable-5-2', 6),
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
        models: [
            model('claude-opus-5-5', 5),
            model('claude-fable-5-2', 6),
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
            model('anthropic/claude-fable-5.2', 6),
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
        provider: 'opencode',
        label: 'OpenCode',
        keyName: 'OPENCODE_API_KEY',
        section: 'subscription',
        apiKeyUrl: 'https://opencode.ai/auth',
        models: [
            ...DEFAULT_CONNECTION_MODELS.opencode,
            ...OPENCODE_SNAPSHOT.filter(m => m.plan === 'go' && isFreeOpencodeModel(m.price)).map(m => m.id),
            ...OPENCODE_SNAPSHOT.filter(m => m.plan === 'console').map(m => m.id),
        ].map(id => model(id)),
    },
]

const MODEL_PROVIDER_LABEL: Record<string, string> = Object.fromEntries(ENGINE_MODEL_CATALOG.flatMap(p => p.models.map(m => [m.id, p.label])))

export function modelLogLabel(id: string | null | undefined): string {
    if (!id) return ''
    const label = MODEL_LABEL[id]
    if (!label) return id
    const provider = MODEL_PROVIDER_LABEL[id]
    return provider && provider !== label ? `${provider} ${label}` : label
}

const MODEL_POWER: Record<string, number> = Object.fromEntries(ENGINE_MODEL_CATALOG.flatMap(p => p.models.flatMap(m => (m.power ? [[m.id, m.power]] : []))))

export function modelPower(id: string | null | undefined): number | undefined {
    return id ? MODEL_POWER[id] : undefined
}

export const ALL_CATALOG_MODEL_IDS: string[] = ENGINE_MODEL_CATALOG.flatMap(p => p.models.map(m => m.id))

const CATALOG_BY_PROVIDER: Record<string, CatalogProvider> = Object.fromEntries(ENGINE_MODEL_CATALOG.map(p => [p.provider, p]))

export function catalogFor(provider: string): CatalogProvider {
    return CATALOG_BY_PROVIDER[provider] ?? { provider, label: provider, keyName: '', section: 'api', models: [] }
}
