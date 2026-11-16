import { z } from 'zod'
import { OPENCODE_DEFAULT_MODEL } from './opencode.js'

export const MCP_SERVER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/
export const mcpServerNameSchema = z.string().regex(MCP_SERVER_NAME_RE, 'must be 1-64 characters: letters, digits, underscores, or hyphens')

export const mcpServerSchema = z.object({
    name: z.string(),
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).default({}),
    headers: z.record(z.string(), z.string()).default({}),
    tools: z.array(z.string().min(1).max(128)).max(200).optional(),
})
export type McpServer = z.infer<typeof mcpServerSchema>
export const strictMcpServerSchema = mcpServerSchema.extend({ name: mcpServerNameSchema })

export const toolsSchema = z.object({
    filesystem: z.boolean().default(true),
    shared: z.boolean().default(true),
    shell: z.boolean().default(true),
    web: z.boolean().default(true),
    memory: z.boolean().default(true),
    db: z.boolean().default(true),
    sharedDb: z.boolean().default(true),
    skills: z.boolean().default(true),
    schedule: z.boolean().default(true),
    trigger: z.boolean().default(true),
    delegate: z.boolean().default(true),
    callAgent: z.boolean().default(true),
    team: z.boolean().default(true),
    aiProviders: z.boolean().default(true),
    browser: z.boolean().default(true),
    vision: z.boolean().default(true),
    notify: z.boolean().default(true),
    askUser: z.boolean().default(true),
    requestApproval: z.boolean().default(true),
    suggestService: z.boolean().default(true),
    requestSecret: z.boolean().default(true),
    hub: z.boolean().default(true),
    cards: z.boolean().default(true),
    quickReplies: z.boolean().default(true),
    brain: z.boolean().default(true),
    computer: z.boolean().default(true),
    paidData: z.boolean().default(true),
})
export type Tools = z.infer<typeof toolsSchema>

export type ToolKey = keyof Tools

export const TOOL_KEYS = Object.keys(toolsSchema.shape) as ToolKey[]

export const selfImprovementSchema = z.object({
    enabled: z.boolean().default(true),
    allowToolInstall: z.boolean().default(true),
    allowSoulEdit: z.boolean().default(true),
    autoMemory: z.boolean().default(true),
})
export type SelfImprovement = z.infer<typeof selfImprovementSchema>

export type SelfImprovementKey = keyof SelfImprovement
export const SELF_IMPROVEMENT_KEYS = Object.keys(selfImprovementSchema.shape) as SelfImprovementKey[]

export const providerSchema = z.enum(['rerun', 'anthropic', 'claude', 'codex', 'openai', 'google', 'openrouter', 'opencode', 'custom'])
export type Provider = z.infer<typeof providerSchema>

export const RERUN_MODELS = { fast: 'rerun-fast', balanced: 'rerun-max', smart: 'rerun-smart' } as const
export type RerunTier = keyof typeof RERUN_MODELS

export const RERUN_TIERS = Object.keys(RERUN_MODELS) as RerunTier[]

export const RERUN_MODEL = RERUN_MODELS.balanced

export function rerunTierOf(model: unknown): RerunTier {
    return RERUN_TIERS.find(tier => RERUN_MODELS[tier] === model) ?? 'balanced'
}

export const rerunUpstreamModelsSchema = z.object({ models: z.record(z.string(), z.string()) })
export type RerunUpstreamModels = z.infer<typeof rerunUpstreamModelsSchema>

export const DEFAULT_PROVIDER_MODEL: Record<Provider, string> = {
    rerun: RERUN_MODEL,
    anthropic: 'claude-sonnet-4-6',
    claude: 'claude-opus-5-5',
    codex: 'gpt-6-sol',
    openai: 'gpt-5.4',
    google: 'gemini-3.6-flash',
    openrouter: 'anthropic/claude-sonnet-5.5',
    opencode: OPENCODE_DEFAULT_MODEL,
    custom: '',
}

export const verbositySchema = z.enum(['minimal', 'concise', 'normal', 'detailed'])
export type Verbosity = z.infer<typeof verbositySchema>
export const VERBOSITY_LEVELS = verbositySchema.options

export const agentSetupSchema = z.object({
    required: z.boolean().nullable().default(null),
    completedAt: z.string().nullable().default(null),
    sessionId: z.string().nullable().default(null),
})
export type AgentSetup = z.infer<typeof agentSetupSchema>

export function isSetupAnswered(setup: { required: boolean | null; prompt: string }): boolean {
    return setup.required === false || (setup.required === true && setup.prompt.trim().length > 0)
}

export const thinkingLevelSchema = z.enum(['low', 'medium', 'high', 'xhigh'])
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>

export const agentConfigSchema = z.object({
    name: z.string(),
    kind: z.enum(['user', 'foreman']).default('user'),
    ephemeral: z.boolean().default(false),
    enabled: z.boolean().default(true),
    displayName: z.string().optional(),
    description: z.string().default(''),
    connectionId: z.string().nullable().default(null),
    provider: providerSchema.nullable().default(null),
    model: z.string().nullable().default(null),
    verbosity: verbositySchema.default('normal'),
    thinkingLevel: thinkingLevelSchema.nullable().optional(),
    pages: z.object({ skim: z.boolean().optional(), standingInstructions: z.literal(false).optional() }).strict().optional(),
    disabledSkills: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).optional(),
    language: z.string().nullable().default(null),
    tools: toolsSchema.prefault({}),
    mcpServers: z.array(mcpServerSchema).default([]),
    selfImprovement: selfImprovementSchema.prefault({}),
    setup: agentSetupSchema.prefault({}),
})
export type AgentConfig = z.infer<typeof agentConfigSchema>

export const createAgentSchema = z.object({
    config: agentConfigSchema.omit({ kind: true }).partial().extend({ name: z.string() }),
    soul: z.string().optional(),
    install: z.string().optional(),
    keys: z.record(z.string(), z.string()).optional(),
})
export type CreateAgentInput = z.infer<typeof createAgentSchema>

export const createCoworkerSchema = z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(2000).optional(),
    spaceId: z.string().uuid(),
})
export type CreateCoworkerInput = z.infer<typeof createCoworkerSchema>

export const createdCoworkerSchema = z.object({
    agentId: z.string(),
    active: z.boolean(),
    sessionId: z.string().nullable(),
    runId: z.string().nullable(),
})
export type CreatedCoworker = z.infer<typeof createdCoworkerSchema>

export const renameCoworkerSchema = z.object({ name: z.string().trim().min(1).max(60) })
export type RenameCoworkerInput = z.infer<typeof renameCoworkerSchema>

export const coworkerNotifyModeSchema = z.enum(['default', 'everything', 'muted'])
export type CoworkerNotifyMode = z.infer<typeof coworkerNotifyModeSchema>

export const coworkerNotificationsSchema = z.object({ mode: coworkerNotifyModeSchema })
export type CoworkerNotifications = z.infer<typeof coworkerNotificationsSchema>

export const duplicateAgentSchema = z.object({
    name: z.string(),
    displayName: z.string().optional(),
})
export type DuplicateAgentInput = z.infer<typeof duplicateAgentSchema>

export const agentDuplicateResultSchema = z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string().default(''),
    description: z.string().default(''),
    schedules: z.array(z.string()).default([]),
    triggers: z.array(z.string()).default([]),
    memoriesIndexed: z.number().int().nonnegative().default(0),
})
export type AgentDuplicateResult = z.infer<typeof agentDuplicateResultSchema>

export const updateAgentSchema = agentConfigSchema.omit({ kind: true }).partial()

export const agentKeysListSchema = z.object({ keys: z.array(z.string()), engineKeys: z.array(z.string()).optional() })
export type AgentKeysList = z.infer<typeof agentKeysListSchema>

export const updateAgentKeysSchema = z.object({
    set: z.record(z.string(), z.string()).default({}),
    remove: z.array(z.string()).default([]),
})

export const updateAgentMcpServersSchema = z.object({
    upsert: z.array(strictMcpServerSchema).default([]),
    remove: z.array(z.string()).default([]),
})

export const mcpTokenSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    scope: z.string().optional(),
    tokenEndpoint: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    obtainedAt: z.number().optional(),
})

export const mcpServerStatusSchema = z.object({
    name: z.string(),
    status: z.enum(['connected', 'needs_auth', 'error']),
    transport: z.enum(['stdio', 'sse', 'http']),
    toolCount: z.number().int().nonnegative(),
    error: z.string().optional(),
})
export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>

export const mcpServerStatusListSchema = z.object({ servers: z.array(mcpServerStatusSchema) })

export const mcpErrorClassSchema = z.enum(['auth', 'timeout', 'unreachable', 'closed', 'other'])
export type McpErrorClass = z.infer<typeof mcpErrorClassSchema>

export const mcpSessionStateSchema = z
    .object({
        name: z.string(),
        state: z.enum(['connected', 'connecting', 'failed', 'idle']),
        errorClass: mcpErrorClassSchema.optional(),
    })
    .strict()
export type McpSessionState = z.infer<typeof mcpSessionStateSchema>

export const mcpSessionStateListSchema = z.object({ servers: z.array(mcpSessionStateSchema) })
export type McpSessionStateList = z.infer<typeof mcpSessionStateListSchema>

export const mcpReconnectEffectSchema = z.enum(['next_call', 'next_message'])
export type McpReconnectEffect = z.infer<typeof mcpReconnectEffectSchema>

export const mcpReconnectResultSchema = z
    .object({
        name: z.string(),
        reconnected: z.boolean(),
        effect: mcpReconnectEffectSchema,
        announced: z.number().int().nonnegative(),
    })
    .strict()
export type McpReconnectResult = z.infer<typeof mcpReconnectResultSchema>

export const mcpReconnectEventSchema = z.object({ name: z.string(), effect: mcpReconnectEffectSchema }).strict()
export type McpReconnectEvent = z.infer<typeof mcpReconnectEventSchema>

export const mcpServerToolSchema = z.object({ name: z.string(), description: z.string(), tokens: z.number().int().nonnegative(), picked: z.boolean() }).strict()
export type McpServerTool = z.infer<typeof mcpServerToolSchema>

export const mcpServerToolListSchema = z.object({ name: z.string(), picks: z.array(z.string()), tools: z.array(mcpServerToolSchema) })
export type McpServerToolList = z.infer<typeof mcpServerToolListSchema>

export const agentDetailSchema = z.object({
    id: z.string(),
    config: agentConfigSchema,
    soul: z.string(),
    install: z.string().default(''),
    resolvedConnectionId: z.string().nullable().default(null),
    resolvedProvider: providerSchema.nullable().default(null),
    resolvedModel: z.string().nullable().default(null),
})
export type AgentDetail = z.infer<typeof agentDetailSchema>

export const activatedAutomationsSchema = z.object({
    schedules: z.array(z.string()).default([]),
    triggers: z.array(z.string()).default([]),
})
export type ActivatedAutomations = z.infer<typeof activatedAutomationsSchema>
