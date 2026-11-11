import { z } from 'zod'
import { RERUN_MODELS, providerSchema, type Provider } from './agent.js'
import { OPENCODE_DEFAULT_MODEL, isFreeOpencodeModel, providerModelSchema, type ProviderModel } from './opencode.js'
import { OPENCODE_SNAPSHOT } from './opencode-snapshot.js'

// A named credential held by the box rather than by an agent. Agents point at one through
// `config.connectionId`, so plugging a subscription once is enough for every agent on the box, and
// a single refresh lineage serves all of them instead of one per agent.
export const connectionConfigSchema = z.object({
    name: z.string().min(1),
    provider: providerSchema,
    // The model ids this connection offers. Curation lives here rather than in the browser, so it
    // is shared by everyone on the box and survives a new device.
    models: z.array(z.string()).default([]),
    // Where the requests go: an OpenRouter-compatible router of the user's own, or the endpoint of a
    // `custom` connection, which has nowhere else to go. Empty falls back to openrouter.ai, and it has
    // to be a valid member of the type since a PATCH cannot clear a field by sending `undefined`.
    baseUrl: z.url().or(z.literal('')).optional(),
    // Model ids beyond the UI's curated catalog, typed by hand on an OpenRouter or custom connection.
    extraModels: z.array(z.string()).default([]),
    // What a `custom` endpoint does not say about itself. The window applies to every model the
    // endpoint's own listing gives none for; null is how a PATCH clears it.
    contextWindow: z.number().int().positive().nullable().optional(),
    vision: z.boolean().optional(),
    createdAt: z.string(),
})
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>

// The id of the keyless connection every box carries: requests are proxied by the hub, which holds
// the shared key. It has a config.json like any other but no `.env`, and cannot be deleted.
export const RERUN_CONNECTION_ID = 'rerun'

// One metered window of a subscription: the rolling session, the week, a per-model weekly cap, or the
// month (OpenCode Go).
export const planLimitWindowSchema = z.object({
    kind: z.enum(['session', 'weekly', 'model', 'monthly']),
    // Only a `model` window carries one: the name of the model it meters.
    label: z.string().nullable(),
    usedPercent: z.number(),
    resetsAt: z.string().nullable(),
})
export type PlanLimitWindow = z.infer<typeof planLimitWindowSchema>

// Where a subscription stands against its plan, as last reported by its own CLI. Named "limits"
// because "usage" on a connection already means what points at it.
export const planLimitsSchema = z.object({
    windows: z.array(planLimitWindowSchema),
    capturedAt: z.string(),
})
export type PlanLimits = z.infer<typeof planLimitsSchema>

// The models a subscription's own CLI says it serves, asked of the binary the box runs (Codex's
// `model/list`, Claude Code's `supportedModels`). Codex answers for the account: an old binary has
// never heard of a new model, a free plan is not offered a paid one, and `outdated` tells the two
// apart (the binary is not the one this engine release pins). Claude Code only names its own picker,
// a model it leaves out still runs, so its reading is kept for diagnosis and refuses nothing.
export const cliModelsSchema = z.object({
    models: z.array(z.string()),
    version: z.string().nullable(),
    outdated: z.boolean(),
    capturedAt: z.string(),
})
export type CliModels = z.infer<typeof cliModelsSchema>

// The 1M-context variants of a Claude model run on the same binary entry as the model itself.
const cliModelKey = (id: string): string => id.replace(/\[1m\]$/, '')

// Without a reading nothing is refused: a probe that failed must never lock models that work.
export function cliServesModel(provider: Provider, cliModels: CliModels | null | undefined, id: string): boolean {
    if (provider !== 'codex' || !cliModels) return true
    const key = cliModelKey(id)
    return cliModels.models.some(model => cliModelKey(model) === key)
}

// A model OpenCode stopped publishing. Without a live reading nothing is refused, as with the CLIs.
export function opencodeServesModel(provider: Provider, providerModels: ProviderModel[] | null | undefined, id: string): boolean {
    if (provider !== 'opencode' || !providerModels) return true
    return providerModels.some(model => model.id === id)
}

// One model a custom endpoint lists, with the context window when the server states it (OpenRouter
// and LM Studio say `context_length`, vLLM `max_model_len`, Ollama nothing).
export const discoveredModelSchema = z.object({ id: z.string(), contextWindow: z.number().nullable() })
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>

export const connectionSummarySchema = connectionConfigSchema.extend({
    id: z.string(),
    // Whether the credential behind it is present. The value itself is never returned.
    connected: z.boolean(),
    // The credential is on file but its provider turned it away (a dead refresh token, a run
    // answered with a 401): `connected` cannot tell, and the user has to sign in again. Defaulted
    // for an engine older than it.
    credentialRejected: z.boolean().default(false),
    // Defaulted rather than required: an engine older than plan limits answers without it.
    planLimits: planLimitsSchema.nullable().default(null),
    cliModels: cliModelsSchema.nullable().default(null),
    // The models an API-key provider with a live catalog reaches today (OpenCode). Null on every
    // other provider, and on an engine older than it: the hub then falls back on its snapshot.
    providerModels: z.array(providerModelSchema).nullable().default(null),
    // What a `custom` endpoint listed at `GET /models` when the box last asked. Null on every other
    // provider, before the first answer, and on an engine older than it.
    discoveredModels: z.array(discoveredModelSchema).nullable().default(null),
})
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>

// The pair a box runs when an agent names no model of its own. One record for the whole box rather
// than a flag on each connection.json: "exactly one of them is true" is an invariant nothing can
// hold across N independent writes, and the default is a pair anyway.
export const boxDefaultModelSchema = z.object({ connectionId: z.string(), model: z.string() })
export type BoxDefaultModel = z.infer<typeof boxDefaultModelSchema>

export const connectionsListSchema = z.object({
    connections: z.array(connectionSummarySchema),
    // Defaulted rather than required: an engine older than box defaults answers a list without it.
    default: boxDefaultModelSchema.nullable().default(null),
})
export type ConnectionsList = z.infer<typeof connectionsListSchema>

export const createConnectionSchema = z.object({
    name: z.string().min(1),
    provider: providerSchema,
    models: z.array(z.string()).default([]),
    baseUrl: z.url().or(z.literal('')).optional(),
    extraModels: z.array(z.string()).default([]),
    contextWindow: z.number().int().positive().nullable().optional(),
    vision: z.boolean().optional(),
    keys: z.record(z.string(), z.string()).default({}),
})
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>

// The provider is fixed at creation: changing it would leave the connection holding a credential
// no provider reads, which reads as "connected" while every run fails.
export const updateConnectionSchema = z.object({
    name: z.string().min(1).optional(),
    models: z.array(z.string()).optional(),
    baseUrl: z.url().or(z.literal('')).optional(),
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

// What still points at a connection, and therefore what a delete moves back onto the box default
// model: the answer both to "what would this cost me" before the fact and "what did it do" after.
export const connectionUsageSchema = z.object({
    agents: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
    automations: z.array(z.object({ agentId: z.string(), kind: z.enum(['schedule', 'trigger']), slug: z.string() })).default([]),
    // Nothing points at the box default by name, so it needs its own flag: deleting the connection
    // that holds it clears it, and that is worth announcing on its own.
    isBoxDefault: z.boolean().default(false),
})
export type ConnectionUsage = z.infer<typeof connectionUsageSchema>

// A delete never refuses over usage: it releases everything that named the connection first and
// reports it here, so the UI can say what moved instead of asking the user to repoint it by hand.
export const deleteConnectionResultSchema = z.object({ deleted: z.string(), released: connectionUsageSchema })

// The env var name each provider's credential is stored under, and the satellites written
// alongside it by the OAuth flows. `rerun` has none: it is keyless.
export const CONNECTION_TOKEN_KEY: Record<z.infer<typeof providerSchema>, string> = {
    rerun: '',
    anthropic: 'ANTHROPIC_API_KEY',
    claude: 'CLAUDE_CODE_OAUTH_TOKEN',
    codex: 'CODEX_OAUTH_TOKEN',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    // Optional: a local server (Ollama, LM Studio) takes requests without one.
    custom: 'CUSTOM_API_KEY',
}

// What is wrong with a value about to be stored as a Claude subscription token, or null when it
// looks like one. Saved as is, the authorization code Claude shows (`code#state`) or an API key
// reads as "connected" and fails every run with "401 Invalid bearer token". Claude's tokens all
// start with `sk-ant-` (`sk-ant-oat…` from the sign-in and from `claude setup-token`). The issues are
// named after the `errors` codes the hub answers with, so a client reads them from that pack.
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
    // The engine still resolves this alias, so a migration has to carry it over.
    google: ['GOOGLE_API_KEY'],
    openrouter: [],
    opencode: [],
    custom: [],
}

// Every env var name that used to live on an agent and now belongs to a connection. What the boot
// migration strips from each agent's `.env`, leaving MCP secrets and shell variables behind.
export const CONNECTION_ENV_KEYS: string[] = [...Object.values(CONNECTION_TOKEN_KEY).filter(Boolean), ...Object.values(CONNECTION_SATELLITE_KEYS).flat()]

// What a freshly created connection offers before anyone curates it, and what the boot migration
// seeds an imported credential with. The engine needs these ids without depending on the UI, so
// they live here; `ENGINE_MODEL_CATALOG` in the UI carries the labels and power ratings for the
// same ids and a test keeps the two lists equal.
export const DEFAULT_CONNECTION_MODELS: Record<z.infer<typeof providerSchema>, string[]> = {
    // A connection's first model is what it runs when none is named. On a subscription that is one
    // step below the top tier: not every plan includes the top model, and a box that adopts it on
    // connect fails its very first run ("Fable 5.1 requires usage credits").
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
    // Claude Code's own picker, id for id. `[1m]` is how the CLI names the 1M-context variant of a
    // model whose default window is smaller; Fable, Opus 5/5.5, Sonnet 5.5 and Haiku 5.5 are 1M
    // natively and take no suffix.
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
    // Every model the Go plan charges for, the default first. Console models are paid per token
    // from the account's credits, and a free Go model can train on what it is sent, so both start
    // switched off: they are listed, and switched on one by one.
    opencode: [
        OPENCODE_DEFAULT_MODEL,
        ...OPENCODE_SNAPSHOT.filter(model => model.plan === 'go' && !isFreeOpencodeModel(model.price) && model.id !== OPENCODE_DEFAULT_MODEL).map(model => model.id),
    ],
    // Only the endpoint knows what it serves: the models arrive with the connection, read off it.
    custom: [],
}

// How a connection names itself when nobody has yet: the boot migration builds "Claude (Theo)"
// from this, and the UI seeds the name field with it.
export const PROVIDER_LABELS: Record<z.infer<typeof providerSchema>, string> = {
    rerun: 'Rerun',
    anthropic: 'Anthropic',
    claude: 'Claude',
    codex: 'Codex',
    openai: 'OpenAI',
    google: 'Google',
    openrouter: 'OpenRouter',
    opencode: 'OpenCode',
    custom: 'Custom',
}

// The model the app's picker offers for one coworker, grouped and labelled by the hub with the web
// picker's own rules (hidden, locked, tier order), so the two never drift.
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
    // What the coworker pinned; null when it follows the box.
    pinned: modelChoiceSchema.nullable(),
    // What it runs today, pin or box default; null on an engine too old to say.
    resolved: modelChoiceSchema.nullable(),
    boxDefault: modelChoiceSchema.nullable(),
})
export type AgentModels = z.infer<typeof agentModelsSchema>

// A pin, or both null to follow the box again.
export const setAgentModelSchema = z.union([modelChoiceSchema, z.object({ connectionId: z.null(), model: z.null() })])
export type SetAgentModelInput = z.infer<typeof setAgentModelSchema>

// The AI providers screen of the app, shaped by the hub with the web dialog's own rules (catalog,
// hidden and locked models, plan windows, credit), since those live in apps/ui.
export const addableProviderSchema = providerSchema.exclude(['rerun'])
export type AddableProvider = z.infer<typeof addableProviderSchema>

export const aiConnectionKindSchema = z.enum(['included', 'plan', 'key'])
export type AiConnectionKind = z.infer<typeof aiConnectionKindSchema>

// `reconnect` covers both a credential gone and one its provider turned away; `credentialOnFile`
// tells the two apart for the wording.
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
    // What coworkers with no model of their own run on, Rerun when nothing is set.
    default: z.object({ connectionId: z.string(), model: z.string(), label: z.string() }),
    credit: z.object({ percent: z.number(), usedUp: z.boolean(), backOn: z.string() }),
    addable: z.array(
        z.object({
            provider: addableProviderSchema,
            kind: aiConnectionKindSchema,
            title: z.string(),
            hint: z.string(),
            suggestedName: z.string(),
            // Markdown steps, for the API key providers only.
            guide: z.object({ title: z.string(), steps: z.string() }).nullable(),
        })
    ),
})
export type AiConnectionsView = z.infer<typeof aiConnectionsViewSchema>

// The app sends the one value it holds; the hub knows which env var each provider stores it under.
// For `claude` it is a setup-token pasted by hand. A `custom` endpoint needs its address instead, and
// the key is optional there: a local server takes requests without one.
export const createAiConnectionInputSchema = z
    .object({
        provider: addableProviderSchema,
        apiKey: z.string().trim().optional(),
        name: z.string().trim().min(1).optional(),
        baseUrl: z.url().or(z.literal('')).optional(),
        models: z.array(z.string().trim().min(1)).optional(),
    })
    .refine(input => input.provider === 'custom' || !!input.apiKey, { message: 'An API key is required', path: ['apiKey'] })
    .refine(input => input.provider !== 'custom' || !!input.baseUrl, { message: 'A base URL is required', path: ['baseUrl'] })
export type CreateAiConnectionInput = z.infer<typeof createAiConnectionInputSchema>

export const replaceAiConnectionKeyInputSchema = z.object({ apiKey: z.string().trim().min(1) })

export const workspaceDefaultInputSchema = z.union([modelChoiceSchema, z.object({ connectionId: z.null(), model: z.null() })])
export type WorkspaceDefaultInput = z.infer<typeof workspaceDefaultInputSchema>

export const aiConnectionCreatedSchema = z.object({ connectionId: z.string() })

// `ticket` is what the hub keeps of the sign-in (the PKCE pair, the device code), sealed and bound to
// the person who started it: the phone carries it back, it never reads it.
export const claudeSignInStartSchema = z.object({ authorizeUrl: z.string(), ticket: z.string() })
export type ClaudeSignInStart = z.infer<typeof claudeSignInStartSchema>

// The exchange and the write happen in the same hub call, so the subscription tokens never reach
// the phone. `connectionId` signs an existing connection in again instead of adding one.
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
