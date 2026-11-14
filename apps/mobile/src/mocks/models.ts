export type ModelProvider = 'rerun' | 'claude' | 'codex' | 'google' | 'opencode'

export type Model = { id: string; label: string; provider: ModelProvider }

export type ModelGroup = { provider: ModelProvider; label: string; models: Model[] }

const group = (provider: ModelProvider, label: string, models: [string, string][]): ModelGroup => ({ provider, label, models: models.map(([id, name]) => ({ id, label: name, provider })) })

export const MODEL_GROUPS: ModelGroup[] = [
    group('rerun', 'Rerun', [
        ['rerun-max', 'Rerun'],
        ['rerun-smart', 'Smart'],
        ['rerun-fast', 'Fast'],
    ]),
    group('claude', 'Claude (Subscription)', [
        ['claude-opus-5-5', 'Opus 5.5'],
        ['claude-fable-5-1', 'Fable 5.1'],
        ['claude-sonnet-5[1m]', 'Sonnet 5 1M'],
        ['claude-haiku-4-5', 'Haiku 4.5'],
    ]),
    group('codex', 'Codex (Subscription)', [
        ['gpt-6-sol', 'GPT-6 Sol'],
        ['gpt-6-astra', 'GPT-6 Astra'],
        ['gpt-6-luna', 'GPT-6 Luna'],
    ]),
    group('google', 'Google', [
        ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
        ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro'],
    ]),
]

export const FAVORITE_MODEL_IDS = ['rerun-max', 'rerun-smart', 'rerun-fast', 'claude-opus-5-5', 'gpt-6-sol']

const ALL_MODELS = MODEL_GROUPS.flatMap(entry => entry.models)

export function findModel(id: string): Model {
    return ALL_MODELS.find(model => model.id === id) ?? ALL_MODELS[0]
}
