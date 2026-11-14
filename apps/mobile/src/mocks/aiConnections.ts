import type { AiConnectionView, AiConnectionsView, ConnectionUsage } from '@rerun/contracts'

const RERUN: AiConnectionView = {
    id: 'rerun',
    name: 'Rerun',
    provider: 'rerun',
    kind: 'included',
    status: 'connected',
    credentialOnFile: true,
    summary: "20% of this month's credits used",
    isDefault: true,
    models: [{ id: 'rerun-max', label: 'Rerun', enabled: true, locked: false }],
    baseUrl: '',
    extraModels: [],
    planWindows: [],
}

const CLAUDE: AiConnectionView = {
    id: 'cnx-claude',
    name: 'Claude',
    provider: 'claude',
    kind: 'plan',
    status: 'connected',
    credentialOnFile: true,
    summary: 'Session 34% · Weekly 12%',
    isDefault: false,
    models: [
        { id: 'claude-opus-5-5', label: 'Opus 5.5', enabled: true, locked: false },
        { id: 'claude-fable-5-1', label: 'Fable 5.1', enabled: true, locked: false },
        { id: 'claude-fable-5', label: 'Fable 5', enabled: false, locked: false },
        { id: 'claude-opus-5', label: 'Opus 5', enabled: true, locked: false },
        { id: 'claude-sonnet-5[1m]', label: 'Sonnet 5 (1M)', enabled: true, locked: false },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', enabled: true, locked: false },
        { id: 'claude-haiku-4-5', label: 'Haiku 4.5', enabled: false, locked: false },
    ],
    baseUrl: '',
    extraModels: [],
    planWindows: [
        { name: 'Session', usedPercent: 34, reset: 'resets in 2h' },
        { name: 'Weekly', usedPercent: 12, reset: 'resets in 5d' },
        { name: 'Opus weekly', usedPercent: 81, reset: 'resets in 5d' },
    ],
}

const CHATGPT: AiConnectionView = {
    id: 'cnx-codex',
    name: 'ChatGPT',
    provider: 'codex',
    kind: 'plan',
    status: 'connected',
    credentialOnFile: true,
    summary: 'Plan · 4 models',
    isDefault: false,
    models: [
        { id: 'gpt-6-sol', label: 'GPT-6 Sol', enabled: true, locked: false },
        { id: 'gpt-6-astra', label: 'GPT-6 Astra', enabled: true, locked: false },
        { id: 'gpt-6-luna', label: 'GPT-6 Luna', enabled: true, locked: false },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', enabled: true, locked: false },
    ],
    baseUrl: '',
    extraModels: [],
    planWindows: [],
}

const OPENROUTER: AiConnectionView = {
    id: 'cnx-openrouter',
    name: 'OpenRouter',
    provider: 'openrouter',
    kind: 'key',
    status: 'connected',
    credentialOnFile: true,
    summary: 'API key · 5 models',
    isDefault: false,
    models: [
        { id: 'anthropic/claude-fable-5.1', label: 'Fable 5.1', enabled: true, locked: false },
        { id: 'openai/gpt-6-sol', label: 'GPT-6 Sol', enabled: true, locked: false },
        { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', enabled: true, locked: false },
        { id: 'x-ai/grok-4.6', label: 'Grok 4.6', enabled: false, locked: false },
        { id: 'moonshotai/kimi-k3', label: 'Kimi K3', enabled: true, locked: false },
        { id: 'deepseek/deepseek-v4-pro-thinking', label: 'deepseek/deepseek-v4-pro-thinking', enabled: true, locked: false },
    ],
    baseUrl: '',
    extraModels: ['deepseek/deepseek-v4-pro-thinking'],
    planWindows: [],
}

const OPENCODE: AiConnectionView = {
    id: 'cnx-opencode',
    name: 'OpenCode',
    provider: 'opencode',
    kind: 'plan',
    status: 'connected',
    credentialOnFile: true,
    summary: '5-hour 22% · Weekly 48% · Monthly 12%',
    isDefault: false,
    models: [
        { id: 'go/deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'Included in Go', enabled: true, locked: false },
        { id: 'go/kimi-k3.1-pro', label: 'Kimi K3.1 Pro', description: 'Included in Go', enabled: true, locked: false },
        { id: 'go/glm-5.3', label: 'GLM-5.3', description: 'Included in Go', enabled: true, locked: false },
        { id: 'console/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'Console credits', enabled: false, locked: false },
    ],
    baseUrl: '',
    extraModels: [],
    planWindows: [
        { name: '5-hour', usedPercent: 22, reset: 'resets in 3h' },
        { name: 'Weekly', usedPercent: 48, reset: 'resets in 4d' },
        { name: 'Monthly', usedPercent: 12, reset: 'resets in 21d' },
    ],
}

const apiKey = (provider: 'anthropic' | 'openai' | 'google', name: string, models: [string, string][]): AiConnectionView => ({
    id: `cnx-${provider}`,
    name,
    provider,
    kind: 'key',
    status: 'connected',
    credentialOnFile: true,
    summary: `API key · ${models.length} models`,
    isDefault: false,
    models: models.map(([id, label]) => ({ id, label, enabled: true, locked: false })),
    baseUrl: '',
    extraModels: [],
    planWindows: [],
})

const ANTHROPIC = apiKey('anthropic', 'Anthropic', [
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
])
const OPENAI = apiKey('openai', 'OpenAI', [
    ['gpt-6-sol', 'GPT-6 Sol'],
    ['gpt-6-luna', 'GPT-6 Luna'],
])
const GOOGLE = apiKey('google', 'Google', [
    ['gemini-3.8-pro', 'Gemini 3.8 Pro'],
    ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
])

const ADDABLE: AiConnectionsView['addable'] = [
    { provider: 'claude', kind: 'plan', title: 'Claude Pro or Max', hint: 'Sign in with your Claude account', suggestedName: 'Claude', guide: null },
    { provider: 'codex', kind: 'plan', title: 'ChatGPT Plus or Pro', hint: 'Sign in with your ChatGPT account', suggestedName: 'ChatGPT', guide: null },
    {
        provider: 'opencode',
        kind: 'plan',
        title: 'OpenCode Go or Console',
        hint: 'Paste your OpenCode key',
        suggestedName: 'OpenCode',
        guide: {
            title: 'How to get your OpenCode key',
            steps: '1. Open [OpenCode](https://opencode.ai/auth) and sign in.\n2. Subscribe to **OpenCode Go**, or add credits to use the Console models.\n3. Create an API key, copy it (it starts with `oc_sk_`) and paste it above.',
        },
    },
    {
        provider: 'anthropic',
        kind: 'key',
        title: 'Anthropic',
        hint: 'Claude models, billed per token',
        suggestedName: 'Anthropic',
        guide: {
            title: 'How to get your Anthropic key',
            steps: '1. Open the [Anthropic Console](https://console.anthropic.com/settings/keys) and sign in.\n2. Click **Create Key** and name it, for example "Rerun".\n3. Copy the key (it starts with `sk-ant-`) and paste it above. It is shown only once.',
        },
    },
    {
        provider: 'openai',
        kind: 'key',
        title: 'OpenAI',
        hint: 'GPT models, billed per token',
        suggestedName: 'OpenAI',
        guide: {
            title: 'How to get your OpenAI key',
            steps: '1. Open [OpenAI API keys](https://platform.openai.com/api-keys) and sign in.\n2. Click **Create new secret key** and name it, for example "Rerun".\n3. Copy the key (it starts with `sk-`) and paste it above. It is shown only once.',
        },
    },
    {
        provider: 'google',
        kind: 'key',
        title: 'Google',
        hint: 'Gemini models, billed per token',
        suggestedName: 'Google',
        guide: {
            title: 'How to get your Google key',
            steps: '1. Open [Google AI Studio](https://aistudio.google.com/apikey) and sign in with your Google account.\n2. Click **Create API key** and pick a Google Cloud project.\n3. Copy the key and paste it above.',
        },
    },
    {
        provider: 'openrouter',
        kind: 'key',
        title: 'OpenRouter',
        hint: 'Every model behind one key',
        suggestedName: 'OpenRouter',
        guide: {
            title: 'How to get your OpenRouter key',
            steps: '1. Open [OpenRouter keys](https://openrouter.ai/keys) and sign in.\n2. Click **Create API Key**, and add credits if your balance is empty.\n3. Copy the key (it starts with `sk-or-`) and paste it above. It is shown only once.',
        },
    },
]

const CREDIT = { percent: 20, usedUp: false, backOn: 'on Nov 1' }

export const AI_CONNECTIONS_RERUN_ONLY: AiConnectionsView = {
    connections: [RERUN],
    default: { connectionId: 'rerun', model: 'rerun-max', label: 'Rerun' },
    credit: CREDIT,
    addable: ADDABLE,
}

export const AI_CONNECTIONS_FULL: AiConnectionsView = {
    connections: [{ ...RERUN, isDefault: false }, { ...CLAUDE, isDefault: true }, CHATGPT, OPENCODE, OPENROUTER],
    default: { connectionId: 'cnx-claude', model: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    credit: CREDIT,
    addable: ADDABLE.map(entry => (entry.provider === 'claude' ? { ...entry, suggestedName: 'Claude 2' } : entry.provider === 'codex' ? { ...entry, suggestedName: 'ChatGPT 2' } : entry.provider === 'openrouter' ? { ...entry, suggestedName: 'OpenRouter 2' } : entry)),
}

export const AI_CONNECTIONS_KEYS: AiConnectionsView = {
    connections: [{ ...RERUN, isDefault: false }, { ...ANTHROPIC, isDefault: true }, OPENAI, GOOGLE, OPENROUTER],
    default: { connectionId: 'cnx-anthropic', model: 'claude-opus-5-5', label: 'Opus 5.5' },
    credit: CREDIT,
    addable: ADDABLE.filter(entry => entry.kind === 'key'),
}

export const AI_CONNECTIONS_RECONNECT: AiConnectionsView = {
    ...AI_CONNECTIONS_FULL,
    connections: [
        { ...RERUN, isDefault: false },
        { ...CLAUDE, isDefault: true, status: 'reconnect', summary: 'Plan · 5 models', planWindows: [] },
        CHATGPT,
        { ...OPENCODE, status: 'reconnect', planWindows: [] },
        { ...OPENROUTER, status: 'reconnect', credentialOnFile: true },
    ],
}

export const AI_CONNECTIONS_CREDIT_USED_UP: AiConnectionsView = {
    ...AI_CONNECTIONS_RERUN_ONLY,
    connections: [{ ...RERUN, status: 'credit_used_up', summary: 'Monthly credits used up, back on Nov 1' }],
    credit: { percent: 100, usedUp: true, backOn: 'on Nov 1' },
}

export const AI_CONNECTIONS_TRIAL: AiConnectionsView = {
    ...AI_CONNECTIONS_FULL,
    connections: AI_CONNECTIONS_FULL.connections.map(connection => ({ ...connection, models: connection.models.map(model => ({ ...model, locked: /opus|fable|astra/.test(model.id) })) })),
}

export const MOCK_USAGE: ConnectionUsage = {
    agents: [
        { id: 'agent-scout', name: 'Scout' },
        { id: 'agent-ledger', name: 'Ledger' },
    ],
    automations: [{ agentId: 'agent-scout', kind: 'schedule', slug: 'monday-leads' }],
    isBoxDefault: true,
}
