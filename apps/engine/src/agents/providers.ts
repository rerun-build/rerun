import { createProviderRegistry, wrapLanguageModel, type LanguageModel, type ToolSet } from 'ai'
import type { GoalVerdict, RunGoal } from '@rerun/contracts'
import { goalStopHook } from './claude-goal-hook.js'
import { Agent as UndiciAgent } from 'undici'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createClaudeCode, createCustomMcpServer, type McpServerConfig, type MinimalCallToolResult } from 'ai-sdk-provider-claude-code'
import {
    createCodexAppServer,
    createCodexExec,
    createSdkMcpServer,
    tool as codexTool,
    type CodexAppServerSettings,
    type CodexExecSettings,
    type LocalTool,
} from 'ai-sdk-provider-codex-cli'
import type { ZodObject, ZodRawShape, ZodType } from 'zod'
import type { ContextOccupancy, ContextSize, McpServer, Provider } from '@rerun/contracts'
import { env } from '../config/env.js'
import { codexPath } from '../runtime/codex-cli.js'
import { codexHomeDir } from '../config/paths.js'
import { allowedModel } from '../connections/plan.js'
import { CONNECTION_TOKEN_KEY, RERUN_CONNECTION_ID } from '@rerun/contracts'
import { childProcessEnv, envOverlay } from '../lib/child-env.js'
import { newId } from '../lib/ids.js'
import { resolveTransport } from '../tools/mcp.js'
import { relayMcpServer, type RunMcpServer } from '../tools/mcp-relay.js'
import { claudeContextCapture, type ClaudeContextCapture, type CompactListener } from './claude-context.js'
import { claudeScreenshotMiddleware } from './claude-stream.js'
import { codexMcpCompatibilityMiddleware } from './codex-stream.js'
import { createCodexImageMiddleware } from './codex-images.js'
import { googleToolSchemaMiddleware } from './google-tool-schema.js'
import { createQuickRepliesCapture, type QuickRepliesCapture } from './quick-replies-stream.js'
import { createFakeToolCallGuard } from './fake-tool-call-stream.js'
import { createCardTagGuard } from './card-tag-stream.js'
import { cardTagStopHook } from './claude-card-nudge.js'
import { CLAUDE_DEFAULT_THINKING, thinkingSettingsFor } from './thinking.js'
import { openrouterReasoningMiddleware, reasoningFetchFor } from './openrouter-reasoning.js'
import { cacheBreakpointsFetch } from './openrouter-cache.js'
import { openrouterStreamRetryMiddleware } from './openrouter-stream-retry.js'
import { opencodeLanguageModel } from './opencode.js'
import { opencodeChatReasoningMiddleware, opencodeUsageMiddleware } from './opencode-stream.js'
import { agentProcessEnv } from './process-env.js'
import { BRIDGE_SERVER_NAME, CLI_PROVIDERS, type LoadedAgent } from './types.js'
import { hubCallerHeaders } from '../runtime/hub.js'
import type { StoredScreenshot } from '../runtime/screenshots.js'

export { CLI_PROVIDERS }

const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

const CODEX_MIN_VERSION = '0.144.0'

const BRIDGE_TOOL_TIMEOUT_SEC = 3600

export const CLAUDE_HARNESS_ENV = {
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1',
    CLAUDE_CODE_DISABLE_WORKFLOWS: '1',
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    CLAUDE_CODE_DISABLE_CRON: '1',
} as const

const COMPACT_AT_TOKENS: Record<Exclude<ContextSize, 'off'>, number> = { small: 240000, medium: 480000, large: 940000 }

export const COMPACT_RESERVE_TOKENS = 33000

const CLAUDE_MIN_WINDOW_TOKENS = 100000

const COMPACT_AT_MIN_TOKENS = CLAUDE_MIN_WINDOW_TOKENS - COMPACT_RESERVE_TOKENS

const COMPACT_AT_MAX_TOKENS = 1000000 - COMPACT_RESERVE_TOKENS

export function compactAtTokens(size?: ContextSize): number | null {
    if (size === 'off') return null
    const key = size ?? 'small'
    const raw = process.env[`RERUN_COMPACT_AT_${key.toUpperCase()}`]
    const value = Number(raw)
    return raw !== undefined && Number.isInteger(value) && value >= COMPACT_AT_MIN_TOKENS && value <= COMPACT_AT_MAX_TOKENS ? value : COMPACT_AT_TOKENS[key]
}

export function compactEnvFor(at: number | null): { CLAUDE_CODE_AUTO_COMPACT_WINDOW: string } | { DISABLE_AUTO_COMPACT: '1' } {
    return at === null ? { DISABLE_AUTO_COMPACT: '1' } : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(Math.max(CLAUDE_MIN_WINDOW_TOKENS, at + COMPACT_RESERVE_TOKENS)) }
}

export const CODEX_DISABLED_FEATURES = ['multi_agent', 'multi_agent_v2'] as const

export const CODEX_SKILL_OVERRIDES = { 'skills.bundled.enabled': false, 'skills.include_instructions': false } as const

type CodexMcpServerConfig = NonNullable<CodexAppServerSettings['mcpServers']>[string]
type CodexConfigOverrides = NonNullable<CodexAppServerSettings['configOverrides']>

export const CODEX_HARNESS_OVERRIDES: CodexConfigOverrides = {
    project_doc_max_bytes: 0,
    include_environment_context: false,
    include_permissions_instructions: false,
    include_apps_instructions: false,
    include_collaboration_mode_instructions: false,
    web_search: 'disabled',
    'history.persistence': 'none',
    check_for_update_on_startup: false,
    'analytics.enabled': false,
    'tools.update_plan.enabled': false,
    'tools.experimental_request_user_input.enabled': false,
    'features.apps': false,
    'features.memories': false,
    'features.goals': false,
    'features.tool_suggest': false,
    'features.hooks': false,
    'features.code_mode': false,
    'features.shell_tool': false,
    'features.unified_exec': false,
    'shell_environment_policy.inherit': 'all',
    'shell_environment_policy.ignore_default_excludes': true,
    ...Object.fromEntries(CODEX_DISABLED_FEATURES.map(feature => [`features.${feature}`, false])),
    ...CODEX_SKILL_OVERRIDES,
}

function openaiChat(options: Parameters<typeof createOpenAI>[0]) {
    const p = createOpenAI(options)
    return Object.assign(p, { languageModel: (id: string) => p.chat(id) })
}

function isZodSchema(schema: unknown): boolean {
    return !!schema && typeof schema === 'object' && ('_def' in schema || '~standard' in schema)
}

function bridgeableTools(tools: ToolSet): ToolSet {
    const out: ToolSet = {}
    for (const [name, t] of Object.entries(tools)) {
        if (typeof t.execute === 'function' && isZodSchema(t.inputSchema)) out[name] = t
    }
    return out
}

function nativeMcpEntry(server: McpServer): McpServerConfig | null {
    const kind = resolveTransport(server)
    if (kind === 'stdio') return server.command ? { type: 'stdio', command: server.command, args: server.args, env: server.env } : null
    if (!server.url) return null
    if (kind === 'http') return { type: 'http', url: server.url, headers: server.headers }
    return { type: 'sse', url: server.url, headers: server.headers }
}

export type ScreenshotLookup = (id: string) => StoredScreenshot | undefined

type BridgedTool = ToolSet[string]
type BridgeCall = { requestId?: unknown; signal?: AbortSignal }

const bridgeError = (message: string): MinimalCallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] })

export function claudeBridgeHandler(bridged: BridgedTool, screenshots?: ScreenshotLookup) {
    return async (args: Record<string, unknown>, extra: unknown): Promise<MinimalCallToolResult> => {
        const call = (extra ?? {}) as BridgeCall
        try {
            const result: unknown = await bridged.execute!(args, { toolCallId: call.requestId !== undefined ? String(call.requestId) : newId(), abortSignal: call.signal, messages: [] })
            const text = typeof result === 'string' ? result : (JSON.stringify(result) ?? 'undefined')
            const id = (result as { screenshotId?: unknown } | null)?.screenshotId
            const screenshot = typeof id === 'string' ? screenshots?.(id) : undefined
            return { content: [{ type: 'text', text }, ...(screenshot ? [{ type: 'image' as const, data: screenshot.image.toString('base64'), mimeType: screenshot.mediaType }] : [])] }
        } catch (error) {
            return bridgeError(error instanceof Error ? error.message : String(error))
        }
    }
}

export const OVERLAPPING_BRIDGED_TOOLS: ReadonlySet<string> = new Set(['call_agent'])

export function claudeMcpConfig(tools?: ToolSet, mcpServers: RunMcpServer[] = [], screenshots?: ScreenshotLookup): { mcpServers: Record<string, McpServerConfig>; allowedTools: string[]; toolAliases: Record<string, string> } {
    const bridged = tools ? bridgeableTools(tools) : {}
    const names = Object.keys(bridged)
    const servers: Record<string, McpServerConfig> = {}
    const allowedTools: string[] = []
    if (names.length) {
        servers[BRIDGE_SERVER_NAME] = createCustomMcpServer({
            name: BRIDGE_SERVER_NAME,
            tools: Object.fromEntries(
                names.map(name => [
                    name,
                    {
                        description: bridged[name]!.description ?? '',
                        inputSchema: bridged[name]!.inputSchema as ZodObject<ZodRawShape>,
                        handler: claudeBridgeHandler(bridged[name]!, screenshots),
                        ...(OVERLAPPING_BRIDGED_TOOLS.has(name) ? { annotations: { readOnlyHint: true } } : {}),
                    },
                ])
            ),
        }),
        allowedTools.push(...names.map(n => `mcp__${BRIDGE_SERVER_NAME}__${n}`))
    }
    for (const server of mcpServers) {
        const entry = server.relay ? relayMcpServer(server.relay, BRIDGE_TOOL_TIMEOUT_SEC * 1000) : nativeMcpEntry(server)
        if (!entry || server.name === BRIDGE_SERVER_NAME) continue
        servers[server.name] = entry
        const picked = server.tools ?? []
        if (!server.relay && picked.length) allowedTools.push(...picked.map(tool => `mcp__${server.name}__${tool}`))
        else allowedTools.push(`mcp__${server.name}`)
    }
    return { mcpServers: servers, allowedTools, toolAliases: Object.fromEntries(names.map(n => [n, `mcp__${BRIDGE_SERVER_NAME}__${n}`])) }
}

function codexNativeMcpEntry(server: McpServer): CodexMcpServerConfig | null {
    const kind = resolveTransport(server)
    const enabled = server.tools?.length ? { enabledTools: server.tools } : {}
    if (kind === 'stdio') return server.command ? { transport: 'stdio', command: server.command, args: server.args, env: server.env, ...enabled } : null
    if (kind === 'http' && server.url) return { transport: 'http', url: server.url, httpHeaders: server.headers, ...enabled }
    return null
}

function codexBridgedTools(tools: ToolSet): LocalTool[] {
    return Object.entries(bridgeableTools(tools)).map(([name, t]) =>
        codexTool({
            name,
            description: t.description ?? name,
            parameters: t.inputSchema as ZodType,
            execute: async input => t.execute!(input, { toolCallId: newId(), messages: [] }),
        })
    )
}

export function codexMcpConfig(tools?: ToolSet, mcpServers: McpServer[] = []): Record<string, CodexMcpServerConfig> {
    const servers: Record<string, CodexMcpServerConfig> = {}
    const bridged = tools ? codexBridgedTools(tools) : []
    if (bridged.length) servers[BRIDGE_SERVER_NAME] = createSdkMcpServer({ name: BRIDGE_SERVER_NAME, tools: bridged })
    for (const server of mcpServers) {
        const entry = codexNativeMcpEntry(server)
        if (!entry || server.name === BRIDGE_SERVER_NAME) continue
        servers[server.name] = entry
    }
    return servers
}

export type GoalOption = { goal: RunGoal; record: (v: GoalVerdict) => Promise<void>; hook?: ReturnType<typeof goalStopHook> }

export type CliModelOptions = { system?: string; claudeTools?: readonly string[]; screenshots?: ScreenshotLookup; sessionId?: string; labels?: Record<string, string>; goal?: GoalOption; compactAt?: number | null }

export type ResolveModelOptions = { system?: string; screenshots?: ScreenshotLookup; sessionId?: string; labels?: Record<string, string>; goal?: GoalOption; compactAt?: number | null; onCompact?: CompactListener }

function oneShotSessionId(agent: LoadedAgent, options?: { sessionId?: string }): string {
    return options?.sessionId ?? `${agent.id}:one-shot`
}

export const CLAUDE_RUN_TOOLS = ['WebSearch'] as const

const CLAUDE_SIGN_IN_SCOPES = 'user:profile user:inference'

export function claudeAuthEnv(connection: Record<string, string>): { CLAUDE_CODE_OAUTH_TOKEN: string; CLAUDE_CODE_OAUTH_SCOPES: string | undefined } {
    return {
        CLAUDE_CODE_OAUTH_TOKEN: connection.CLAUDE_CODE_OAUTH_TOKEN ?? '',
        CLAUDE_CODE_OAUTH_SCOPES: connection.CLAUDE_CODE_OAUTH_REFRESH_TOKEN ? CLAUDE_SIGN_IN_SCOPES : undefined,
    }
}

type ClaudeHooks = NonNullable<ClaudeContextCapture['settings']['hooks']>

export function withCardTagNudge(hooks: ClaudeHooks | undefined): ClaudeHooks {
    const stop = hooks?.Stop ?? []
    return { ...hooks, Stop: [...stop, { hooks: [cardTagStopHook] }] }
}

export function withGoalStop(hooks: ClaudeHooks | undefined, goal: GoalOption | undefined): ClaudeHooks {
    if (!goal) return hooks ?? {}
    const stop = hooks?.Stop ?? []
    return { ...hooks, Stop: [...stop, { hooks: [goal.hook ?? goalStopHook(goal.goal, goal.record)] }] }
}

function claudeProvider(agent: LoadedAgent, tools?: ToolSet, mcpServers: RunMcpServer[] = [], capture?: ClaudeContextCapture, options: CliModelOptions = {}) {
    const { mcpServers: servers, allowedTools, toolAliases } = claudeMcpConfig(tools, mcpServers, options.screenshots)
    const { cwd, env: agentEnv } = agentProcessEnv(agent, options.labels)
    const thinking: NonNullable<ReturnType<typeof thinkingSettingsFor>['claudeThinking']> = thinkingSettingsFor('claude', '', agent.config.thinkingLevel).claudeThinking ?? CLAUDE_DEFAULT_THINKING
    return createClaudeCode({
        defaultSettings: {
            persistSession: false,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            tools: [...(options.claudeTools ?? [])],
            strictMcpConfig: true,
            enableFileCheckpointing: false,
            cwd,
            thinking: { type: thinking.type, display: thinking.display },
            ...(thinking.effort ? { effort: thinking.effort } : {}),
            env: {
                ...agentEnv,
                ...CLAUDE_HARNESS_ENV,
                ...claudeAuthEnv(connectionEnv(agent)),
                ANTHROPIC_API_KEY: undefined,
                MCP_TOOL_TIMEOUT: String(BRIDGE_TOOL_TIMEOUT_SEC * 1000),
                ...compactEnvFor(options.compactAt === undefined ? compactAtTokens(agent.config.contextSize) : options.compactAt),
            },
            ...(options.system !== undefined ? { systemPrompt: options.system } : {}),
            ...(allowedTools.length ? { mcpServers: servers, allowedTools } : {}),
            ...(Object.keys(toolAliases).length ? { toolAliases } : {}),
            ...(capture ? { ...capture.settings, hooks: withCardTagNudge(capture.settings.hooks) } : {}),
            ...(options.goal ? { hooks: withGoalStop(capture ? withCardTagNudge(capture.settings.hooks) : undefined, options.goal) } : {}),
        },
    })
}

function connectionEnv(agent: LoadedAgent): Record<string, string> {
    return agent.resolved.connection?.env ?? {}
}

function codexShared(agent: LoadedAgent, labels?: Record<string, string>): CodexExecSettings & CodexAppServerSettings {
    const { cwd, env: agentEnv } = agentProcessEnv(agent, labels)
    const path = codexPath()
    return {
        cwd,
        env: envOverlay(childProcessEnv(agentEnv, { CODEX_HOME: codexHomeDir(agent.resolved.connection?.id ?? RERUN_CONNECTION_ID) })),
        ...(path ? { codexPath: path } : {}),
    }
}

export const CODEX_ONE_SHOT_INSTRUCTIONS = 'Do what the user message asks and answer with the result alone.'

function codexExecProvider(agent: LoadedAgent, labels?: Record<string, string>) {
    return createCodexExec({
        defaultSettings: {
            ...codexShared(agent, labels),
            approvalMode: 'never',
            sandboxMode: 'danger-full-access',
            skipGitRepoCheck: true,
            configOverrides: { ...CODEX_HARNESS_OVERRIDES, instructions: CODEX_ONE_SHOT_INSTRUCTIONS },
        },
    })
}

function codexAppServerProvider(agent: LoadedAgent, tools?: ToolSet, mcpServers: McpServer[] = [], options: CliModelOptions = {}) {
    return createCodexAppServer({
        defaultSettings: {
            ...codexShared(agent, options.labels),
            approvalPolicy: 'never',
            sandboxPolicy: 'danger-full-access',
            autoApprove: true,
            threadMode: 'persistent',
            minCodexVersion: CODEX_MIN_VERSION,
            rmcpClient: true,
            personality: 'none',
            ...(options.system !== undefined ? { baseInstructions: options.system } : {}),
            configOverrides: {
                prefix_mcp_tool_names: true,
                [`mcp_servers.${BRIDGE_SERVER_NAME}.tool_timeout_sec`]: BRIDGE_TOOL_TIMEOUT_SEC,
                model_reasoning_summary: 'auto',
                ...CODEX_HARNESS_OVERRIDES,
                ...(agent.config.tools.web ? { web_search: 'live' } : {}),
            },
            mcpServers: codexMcpConfig(tools, mcpServers),
        },
    })
}

function openrouterCompatibleOptions(agent: LoadedAgent, provider: 'rerun' | 'openrouter'): Parameters<typeof createOpenAI>[0] {
    if (provider === 'rerun') {
        const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: hubKey } = env()
        return { apiKey: hubKey ?? '', baseURL: `${(hub ?? '').replace(/\/$/, '')}/api/llm`, headers: hubCallerHeaders(agent) }
    }
    return {
        apiKey: connectionEnv(agent).OPENROUTER_API_KEY,
        baseURL: (agent.resolved.connection?.config.baseUrl || OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    }
}

const CUSTOM_ENDPOINT_PATIENCE_MS = 60 * 60_000
const customEndpointDispatcher = new UndiciAgent({ headersTimeout: CUSTOM_ENDPOINT_PATIENCE_MS, bodyTimeout: CUSTOM_ENDPOINT_PATIENCE_MS })

const customEndpointFetch: typeof fetch = (input, init) => fetch(input, { ...init, dispatcher: customEndpointDispatcher } as RequestInit)

function customOptions(agent: LoadedAgent): Parameters<typeof createOpenAI>[0] {
    return {
        apiKey: connectionEnv(agent)[CONNECTION_TOKEN_KEY.custom] || 'none',
        baseURL: (agent.resolved.connection?.config.baseUrl ?? '').trim().replace(/\/+$/, ''),
        fetch: customEndpointFetch,
    }
}

function registryFor(agent: LoadedAgent, tools?: ToolSet, mcpServers?: McpServer[], options?: CliModelOptions) {
    const e = connectionEnv(agent)
    return createProviderRegistry({
        rerun: openaiChat(openrouterCompatibleOptions(agent, 'rerun')),
        anthropic: createAnthropic({ apiKey: e.ANTHROPIC_API_KEY }),
        claude: claudeProvider(agent, tools, mcpServers, undefined, options),
        codex: codexExecProvider(agent, options?.labels),
        openai: createOpenAI({ apiKey: e.OPENAI_API_KEY }),
        google: createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY ?? e.GOOGLE_API_KEY }),
        openrouter: openaiChat(openrouterCompatibleOptions(agent, 'openrouter')),
        custom: openaiChat(customOptions(agent)),
    })
}

export type ModelOverride = { connectionId?: string; provider?: Provider; model?: string }

function pairFor(agent: LoadedAgent, override?: ModelOverride): { provider: Provider; model: string } {
    const provider = agent.resolved.provider
    return { provider, model: allowedModel(provider, override?.model ?? agent.resolved.model) }
}

export function modelFor(agent: LoadedAgent, override?: ModelOverride, tools?: ToolSet, mcpServers?: McpServer[], options?: CliModelOptions): LanguageModel {
    const { provider, model } = pairFor(agent, override)
    if (provider === 'opencode') {
        const opencode = opencodeLanguageModel(agent.resolved.connection, model, oneShotSessionId(agent, options))
        return wrapLanguageModel({ model: opencode.model, middleware: opencode.middleware })
    }
    return registryFor(agent, tools, mcpServers, options).languageModel(`${provider}:${model}`)
}

export type ResolvedModel = { model: ReturnType<typeof wrapLanguageModel>; close: () => Promise<void>; contextUsage?: () => ContextOccupancy | undefined; quickReplies: () => QuickRepliesCapture | undefined }

const noClose = async (): Promise<void> => {}

export function resolveModel(agent: LoadedAgent, override?: ModelOverride, tools?: ToolSet, mcpServers?: RunMcpServer[], { system, screenshots, sessionId, labels, goal, compactAt, onCompact }: ResolveModelOptions = {}): ResolvedModel {
    const { provider, model } = pairFor(agent, override)
    const replies = createQuickRepliesCapture()
    const cardTags = createCardTagGuard(agent.id, provider)
    const guard = createFakeToolCallGuard(agent.id)
    if (provider === 'codex') {
        const codex = codexAppServerProvider(agent, tools, mcpServers, { system, labels })
        return { model: wrapLanguageModel({ model: codex(model), middleware: [codexMcpCompatibilityMiddleware, createCodexImageMiddleware(agent.id), replies.middleware, cardTags, guard] }), close: () => codex.close(), quickReplies: replies.read }
    }
    if (provider === 'claude') {
        const capture = claudeContextCapture(agent.resolved.connection?.id, onCompact)
        const claude = claudeProvider(agent, tools, mcpServers, capture, { system, screenshots, labels, goal, compactAt, claudeTools: agent.config.tools.web ? CLAUDE_RUN_TOOLS : [] }).languageModel(model)
        return { model: wrapLanguageModel({ model: claude, middleware: [claudeScreenshotMiddleware, replies.middleware, cardTags, guard] }), close: noClose, contextUsage: capture.read, quickReplies: replies.read }
    }
    if (provider === 'opencode') {
        const opencode = opencodeLanguageModel(agent.resolved.connection, model, sessionId ?? oneShotSessionId(agent))
        return { model: wrapLanguageModel({ model: opencode.model, middleware: [...opencode.middleware, opencodeUsageMiddleware, replies.middleware, cardTags, guard] }), close: noClose, quickReplies: replies.read }
    }
    if (provider === 'rerun' || provider === 'openrouter') {
        const openrouter = openaiChat({ ...openrouterCompatibleOptions(agent, provider), fetch: provider === 'openrouter' ? cacheBreakpointsFetch(reasoningFetchFor(agent.config.thinkingLevel)) : reasoningFetchFor(agent.config.thinkingLevel) })
        return { model: wrapLanguageModel({ model: openrouter.languageModel(model), middleware: [openrouterStreamRetryMiddleware, openrouterReasoningMiddleware, replies.middleware, cardTags, guard] }), close: noClose, quickReplies: replies.read }
    }
    if (provider === 'custom') {
        const custom = openaiChat(customOptions(agent))
        return { model: wrapLanguageModel({ model: custom.languageModel(model), middleware: [openrouterStreamRetryMiddleware, opencodeChatReasoningMiddleware, replies.middleware, cardTags, guard] }), close: noClose, quickReplies: replies.read }
    }
    const middleware = provider === 'google' ? [googleToolSchemaMiddleware, replies.middleware, cardTags, guard] : [replies.middleware, cardTags, guard]
    return { model: wrapLanguageModel({ model: registryFor(agent, tools, mcpServers).languageModel(`${provider}:${model}`), middleware }), close: noClose, quickReplies: replies.read }
}
