import { z } from 'zod'
import { RERUN_MODELS, providerSchema, type Provider } from './agent.js'
import { OPENCODE_DEFAULT_MODEL, isFreeOpencodeModel, providerModelSchema, type ProviderModel } from './opencode.js'
import { OPENCODE_SNAPSHOT } from './opencode-snapshot.js'

const withoutCredentials = (value: string): boolean => {
    if (!URL.canParse(value)) return true
    const url = new URL(value)
    return !url.username && !url.password
}

export const connectionBaseUrlSchema = z.url().refine(withoutCredentials, { message: 'The base URL must not carry a username or password' }).or(z.literal(''))

const storedBaseUrlSchema = z.url().or(z.literal(''))

export const connectionConfigSchema = z.object({
    name: z.string().min(1),
    provider: providerSchema,
    models: z.array(z.string()).default([]),
    baseUrl: storedBaseUrlSchema.optional(),
    extraModels: z.array(z.string()).default([]),
    contextWindow: z.number().int().positive().nullable().optional(),
    vision: z.boolean().optional(),
    createdAt: z.string(),
})
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>

export const RERUN_CONNECTION_ID = 'rerun'

export const planLimitWindowSchema = z.object({
    kind: z.enum(['session', 'weekly', 'model', 'monthly']),
    label: z.string().nullable(),
    usedPercent: z.number(),
    resetsAt: z.string().nullable(),
})
export type PlanLimitWindow = z.infer<typeof planLimitWindowSchema>

export const planLimitsSchema = z.object({
    windows: z.array(planLimitWindowSchema),
    capturedAt: z.string(),
})
export type PlanLimits = z.infer<typeof planLimitsSchema>

export const signInLeftSchema = z.object({
    minutesLeft: z.number().int().nonnegative(),
    renewalDue: z.boolean(),
})
export type SignInLeft = z.infer<typeof signInLeftSchema>

export const cliModelsSchema = z.object({
    models: z.array(z.string()),
    version: z.string().nullable(),
    outdated: z.boolean(),
    capturedAt: z.string(),
})
export type CliModels = z.infer<typeof cliModelsSchema>

const cliModelKey = (id: string): string => id.replace(/\[1m\]$/, '')

export function cliServesModel(provider: Provider, cliModels: CliModels | null | undefined, id: string): boolean {
    if (provider !== 'codex' || !cliModels) return true
    const key = cliModelKey(id)
    return cliModels.models.some(model => cliModelKey(model) === key)
}

export function opencodeServesModel(provider: Provider, providerModels: ProviderModel[] | null | undefined, id: string): boolean {
    if (provider !== 'opencode' || !providerModels) return true
    return providerModels.some(model => model.id === id)
}

export const discoveredModelSchema = z.object({ id: z.string(), contextWindow: z.number().nullable(), label: z.string().optional(), price: providerModelSchema.shape.price.optional() })
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>

export const connectionSummarySchema = connectionConfigSchema.extend({
    id: z.string(),
    connected: z.boolean(),
    credentialRejected: z.boolean().default(false),
    planLimits: planLimitsSchema.nullable().default(null),
    signIn: signInLeftSchema.nullable().optional(),
    cliModels: cliModelsSchema.nullable().default(null),
    providerModels: z.array(providerModelSchema).nullable().default(null),
    discoveredModels: z.array(discoveredModelSchema).nullable().default(null),
})
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>

export const boxDefaultModelSchema = z.object({ connectionId: z.string(), model: z.string() })
export type BoxDefaultModel = z.infer<typeof boxDefaultModelSchema>

export const connectionsListSchema = z.object({
    connections: z.array(connectionSummarySchema),
    default: boxDefaultModelSchema.nullable().default(null),
})
export type ConnectionsList = z.infer<typeof connectionsListSchema>

export const createConnectionSchema = z.object({
    name: z.string().min(1),
    provider: providerSchema,
    models: z.array(z.string()).default([]),
    baseUrl: connectionBaseUrlSchema.optional(),
    extraModels: z.array(z.string()).default([]),
    contextWindow: z.number().int().positive().nullable().optional(),
    vision: z.boolean().optional(),
    keys: z.record(z.string(), z.string()).default({}),
})
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>

export const updateConnectionSchema = z.object({
    name: z.string().min(1).optional(),
    models: z.array(z.string()).optional(),
    baseUrl: connectionBaseUrlSchema.optional(),
    extraModels: z.array(z.string()).optional(),
    contextWindow: z.number().int().positive().nullable().optional(),
    vision: z.boolean().optional(),
})
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>

export const updateConnectionKeysSchema = z.object({
    set: z.record(z.string(), z.string()).default({}),
    remove: z.array(z.string()).default([]),
})
export type UpdateConnectionKeysInput = z.infer<typeof updateConnectionKeysSchema>

export const connectionUsageSchema = z.object({
    agents: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
    automations: z.array(z.object({ agentId: z.string(), kind: z.enum(['schedule', 'trigger']), slug: z.string() })).default([]),
    isBoxDefault: z.boolean().default(false),
})
export type ConnectionUsage = z.infer<typeof connectionUsageSchema>

export const deleteConnectionResultSchema = z.object({ deleted: z.string(), released: connectionUsageSchema })

export const CONNECTION_TOKEN_KEY: Record<z.infer<typeof providerSchema>, string> = {
    rerun: '',
    anthropic: 'ANTHROPIC_API_KEY',
    claude: 'CLAUDE_CODE_OAUTH_TOKEN',
    codex: 'CODEX_OAUTH_TOKEN',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    custom: 'CUSTOM_API_KEY',
}

export type ClaudeTokenIssue = 'claudeTokenIsApiKey' | 'claudeTokenIsCode'

export function claudeTokenIssue(value: string): ClaudeTokenIssue | null {
    const token = value.trim()
    if (token.startsWith('sk-ant-api')) return 'claudeTokenIsApiKey'
    if (!token.startsWith('sk-ant-') || /[\s#]/.test(token)) return 'claudeTokenIsCode'
    return null
}

export const CONNECTION_SATELLITE_KEYS: Record<z.infer<typeof providerSchema>, string[]> = {
    rerun: [],
    anthropic: [],
    claude: ['CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_EXPIRES_AT'],
    codex: ['CODEX_OAUTH_REFRESH_TOKEN', 'CODEX_OAUTH_ID_TOKEN', 'CODEX_OAUTH_ACCOUNT_ID', 'CODEX_OAUTH_EXPIRES_AT'],
    openai: [],
    google: ['GOOGLE_API_KEY'],
    openrouter: [],
    opencode: [],
    custom: [],
}

export const CONNECTION_ENV_KEYS: string[] = [...Object.values(CONNECTION_TOKEN_KEY).filter(Boolean), ...Object.values(CONNECTION_SATELLITE_KEYS).flat()]

export const DEFAULT_CONNECTION_MODELS: Record<z.infer<typeof providerSchema>, string[]> = {
    rerun: [RERUN_MODELS.balanced, RERUN_MODELS.fast, RERUN_MODELS.smart],
    anthropic: [
        'claude-fable-5-2',
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-opus-5-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-sonnet-5-5',
        'claude-sonnet-5',
        'claude-sonnet-4-6',
        'claude-haiku-5-5',
        'claude-haiku-4-5-20251001',
    ],
    claude: [
        'claude-opus-5-5',
        'claude-fable-5-2',
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-opus-5',
        'claude-opus-4-8[1m]',
        'claude-opus-4-7[1m]',
        'claude-opus-4-6[1m]',
        'claude-sonnet-5-5',
        'claude-sonnet-5[1m]',
        'claude-sonnet-4-6[1m]',
        'claude-sonnet-4-6',
        'claude-haiku-5-5',
        'claude-haiku-4-5',
    ],
    codex: ['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    openai: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
    google: ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    openrouter: [
        'anthropic/claude-fable-5.2',
        'anthropic/claude-fable-5.1',
        'anthropic/claude-opus-5.5',
        'anthropic/claude-sonnet-5.5',
        'openai/gpt-6-astra',
        'openai/gpt-6.1-sol',
        'openai/gpt-6-sol',
        'openai/gpt-6-luna',
        'google/gemini-4-argon',
        'google/gemini-3.8-flash',
        'x-ai/grok-4.7',
        'moonshotai/kimi-k3.1-pro',
        'deepseek/deepseek-v4-pro',
        'xiaomi/mimo-v2.6-pro',
        'qwen/qwen3.8-flash',
        'minimax/minimax-m3.1-flash',
    ],
    opencode: [
        OPENCODE_DEFAULT_MODEL,
        ...OPENCODE_SNAPSHOT.filter(model => model.plan === 'go' && !isFreeOpencodeModel(model.price) && model.id !== OPENCODE_DEFAULT_MODEL).map(model => model.id),
    ],
    custom: [],
}

export const PROVIDER_LABELS: Record<z.infer<typeof providerSchema>, string> = {
    rerun: 'Moldwright',
    anthropic: 'Anthropic',
    claude: 'Claude',
    codex: 'Codex',
    openai: 'OpenAI',
    google: 'Google',
    openrouter: 'OpenRouter',
    opencode: 'OpenCode',
    custom: 'Custom',
}

export const modelChoiceSchema = z.object({ connectionId: z.string(), model: z.string() })
export type ModelChoice = z.infer<typeof modelChoiceSchema>

export const agentModelsSchema = z.object({
    groups: z.array(
        z.object({
            connectionId: z.string(),
            label: z.string(),
            provider: providerSchema,
            models: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional(), locked: z.boolean().optional() })),
            defaultModel: z.string(),
        })
    ),
    pinned: modelChoiceSchema.nullable(),
    resolved: modelChoiceSchema.nullable(),
    boxDefault: modelChoiceSchema.nullable(),
})
export type AgentModels = z.infer<typeof agentModelsSchema>

export const setAgentModelSchema = z.union([modelChoiceSchema, z.object({ connectionId: z.null(), model: z.null() })])
export type SetAgentModelInput = z.infer<typeof setAgentModelSchema>

export const addableProviderSchema = providerSchema.exclude(['rerun'])
export type AddableProvider = z.infer<typeof addableProviderSchema>

export const aiConnectionKindSchema = z.enum(['included', 'plan', 'key'])
export type AiConnectionKind = z.infer<typeof aiConnectionKindSchema>

export const aiConnectionStatusSchema = z.enum(['connected', 'reconnect', 'credit_used_up'])

export const aiConnectionViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    provider: providerSchema,
    kind: aiConnectionKindSchema,
    status: aiConnectionStatusSchema,
    credentialOnFile: z.boolean(),
    summary: z.string(),
    isDefault: z.boolean(),
    models: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional(), enabled: z.boolean(), locked: z.boolean() })),
    baseUrl: z.string(),
    extraModels: z.array(z.string()),
    planWindows: z.array(z.object({ name: z.string(), usedPercent: z.number(), reset: z.string().nullable() })),
})
export type AiConnectionView = z.infer<typeof aiConnectionViewSchema>

export const aiConnectionsViewSchema = z.object({
    connections: z.array(aiConnectionViewSchema),
    default: z.object({ connectionId: z.string(), model: z.string(), label: z.string() }),
    credit: z.object({ percent: z.number(), usedUp: z.boolean(), backOn: z.string() }),
    addable: z.array(
        z.object({
            provider: addableProviderSchema,
            kind: aiConnectionKindSchema,
            title: z.string(),
            hint: z.string(),
            suggestedName: z.string(),
            guide: z.object({ title: z.string(), steps: z.string() }).nullable(),
        })
    ),
})
export type AiConnectionsView = z.infer<typeof aiConnectionsViewSchema>

export const createAiConnectionInputSchema = z
    .object({
        provider: addableProviderSchema,
        apiKey: z.string().trim().optional(),
        name: z.string().trim().min(1).optional(),
        baseUrl: connectionBaseUrlSchema.optional(),
        models: z.array(z.string().trim().min(1)).optional(),
    })
    .refine(input => input.provider === 'custom' || !!input.apiKey, { message: 'An API key is required', path: ['apiKey'] })
    .refine(input => input.provider !== 'custom' || !!input.baseUrl, { message: 'A base URL is required', path: ['baseUrl'] })
export type CreateAiConnectionInput = z.infer<typeof createAiConnectionInputSchema>

export const replaceAiConnectionKeyInputSchema = z.object({ apiKey: z.string().trim().min(1) })

export const workspaceDefaultInputSchema = z.union([modelChoiceSchema, z.object({ connectionId: z.null(), model: z.null() })])
export type WorkspaceDefaultInput = z.infer<typeof workspaceDefaultInputSchema>

export const aiConnectionCreatedSchema = z.object({ connectionId: z.string() })

export const claudeSignInStartSchema = z.object({ authorizeUrl: z.string(), ticket: z.string() })
export type ClaudeSignInStart = z.infer<typeof claudeSignInStartSchema>

export const claudeSignInFinishInputSchema = z.object({
    code: z.string().trim().min(1),
    ticket: z.string().min(1),
    connectionId: z.string().optional(),
    name: z.string().trim().min(1).optional(),
})
export type ClaudeSignInFinishInput = z.infer<typeof claudeSignInFinishInputSchema>

export const codexSignInStartSchema = z.object({ ticket: z.string(), userCode: z.string(), verificationUrl: z.string(), pollIntervalMs: z.number(), expiresAt: z.number() })
export type CodexSignInStart = z.infer<typeof codexSignInStartSchema>

export const codexSignInPollInputSchema = z.object({
    ticket: z.string().min(1),
    connectionId: z.string().optional(),
    name: z.string().trim().min(1).optional(),
})
export type CodexSignInPollInput = z.infer<typeof codexSignInPollInputSchema>

export const codexSignInPollSchema = z.discriminatedUnion('status', [z.object({ status: z.literal('pending') }), z.object({ status: z.literal('connected'), connectionId: z.string() })])
export type CodexSignInPoll = z.infer<typeof codexSignInPollSchema>
