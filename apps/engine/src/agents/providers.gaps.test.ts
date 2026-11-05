import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-providers-gaps-'))
process.env.RERUN_HUB_BASE_URL = 'https://hub.example.com/'
process.env.RERUN_API_KEY = 'hub-key'
process.env.RERUN_CODEX_PATH = '/opt/codex/bin/codex'
// The provider SDKs read these from the shell, and a developer routing through a gateway has them set.
delete process.env.ANTHROPIC_BASE_URL
delete process.env.OPENAI_BASE_URL

const { vi } = await import('vitest')

const codexAppServerCalls = vi.hoisted(() => [] as Array<{ defaultSettings: Record<string, any> }>)

vi.mock('ai-sdk-provider-codex-cli', async importOriginal => {
    const original = await importOriginal<typeof import('ai-sdk-provider-codex-cli')>()
    return {
        ...original,
        createCodexAppServer: (options: Parameters<typeof original.createCodexAppServer>[0]) => {
            codexAppServerCalls.push(options as { defaultSettings: Record<string, any> })
            return original.createCodexAppServer(options)
        },
    }
})

const claudeCalls = vi.hoisted(() => [] as Array<{ defaultSettings: Record<string, any> }>)

vi.mock('ai-sdk-provider-claude-code', async importOriginal => {
    const original = await importOriginal<typeof import('ai-sdk-provider-claude-code')>()
    return {
        ...original,
        createClaudeCode: (options: Parameters<typeof original.createClaudeCode>[0]) => {
            claudeCalls.push(options as { defaultSettings: Record<string, any> })
            return original.createClaudeCode(options)
        },
    }
})

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { generateText, tool } = await import('ai')
const { z } = await import('zod')
const { agentConfigSchema, connectionConfigSchema } = await import('@rerun/contracts')
const { CLAUDE_HARNESS_ENV, CODEX_HARNESS_OVERRIDES, CODEX_ONE_SHOT_INSTRUCTIONS, modelFor, resolveModel } = await import('./providers.js')
const { codexHomeDir, workspaceDir } = await import('../config/paths.js')

type Provider = import('@rerun/contracts').Provider

function agentOn(provider: Provider, model: string, keys: Record<string, string> | null, connectionExtra: Record<string, unknown> = {}) {
    const connection = keys
        ? { id: `${provider}-cnx`, config: connectionConfigSchema.parse({ name: provider, provider, createdAt: new Date().toISOString(), ...connectionExtra }), env: keys }
        : null
    return {
        id: `agent-${provider}`,
        config: agentConfigSchema.parse({ name: 'p', provider, model }),
        soul: '',
        install: '',
        env: { AGENT_SECRET: 's' },
        resolved: { connection, provider, model },
    } as any
}

const CHAT_COMPLETION = {
    id: 'c1',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

const ANTHROPIC_MESSAGE = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-8',
    content: [{ type: 'text', text: 'hi' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
}

const GEMINI_RESPONSE = {
    candidates: [{ content: { parts: [{ text: 'hi' }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
}

const realFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

function respondWith(body: unknown): void {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

function sent(): { url: string; headers: Headers; body: Record<string, any> } {
    const [url, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit]
    return { url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) }
}

beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    codexAppServerCalls.length = 0
    claudeCalls.length = 0
})

afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.ANTHROPIC_API_KEY
})

describe('resolveModel over the OpenAI chat format', () => {
    it('sends the keyless rerun provider through the hub proxy with the box key and the coworker, asking for reasoning', async () => {
        respondWith(CHAT_COMPLETION)
        const agent = agentOn('rerun', 'rerun-max', null)
        const resolved = resolveModel(agent)

        await generateText({ model: resolved.model, prompt: 'hello' })

        const request = sent()
        expect(request.url).toBe('https://hub.example.com/api/llm/chat/completions')
        expect(request.headers.get('authorization')).toBe('Bearer hub-key')
        expect(request.headers.get('x-rerun-agent')).toBe(agent.id)
        expect(request.body.model).toBe('rerun-max')
        expect(request.body.reasoning).toEqual({ enabled: true })
        await expect(resolved.close()).resolves.toBeUndefined()
        expect(resolved.contextUsage).toBeUndefined()
    })

    it("sends openrouter to the connection's own router with its key, trailing slashes dropped", async () => {
        respondWith(CHAT_COMPLETION)
        const agent = agentOn('openrouter', 'acme/large', { OPENROUTER_API_KEY: 'or-key' }, { baseUrl: 'https://router.example.com/api/v1//' })

        await generateText({ model: resolveModel(agent).model, prompt: 'hello' })

        const request = sent()
        expect(request.url).toBe('https://router.example.com/api/v1/chat/completions')
        expect(request.headers.get('authorization')).toBe('Bearer or-key')
        expect(request.body.model).toBe('acme/large')
    })

    it('hands an API key provider the plain registry model, with nothing to close', async () => {
        respondWith(ANTHROPIC_MESSAGE)
        const resolved = resolveModel(agentOn('anthropic', 'claude-opus-4-8', { ANTHROPIC_API_KEY: 'ant-key' }))

        await generateText({ model: resolved.model, prompt: 'hello' })

        expect(sent().headers.get('x-api-key')).toBe('ant-key')
        expect(sent().body.model).toBe('claude-opus-4-8')
        await expect(resolved.close()).resolves.toBeUndefined()
    })

    it('falls back to openrouter.ai when the connection names no router', async () => {
        respondWith(CHAT_COMPLETION)

        await generateText({ model: resolveModel(agentOn('openrouter', 'acme/large', { OPENROUTER_API_KEY: 'or-key' })).model, prompt: 'hello' })

        expect(sent().url).toBe('https://openrouter.ai/api/v1/chat/completions')
    })
})

describe('modelFor', () => {
    // Reasoning is asked for only where a thought can be shown: a one-shot call has no one to show it to.
    it('reaches the hub without the reasoning request on a one-shot call', async () => {
        respondWith(CHAT_COMPLETION)

        await generateText({ model: modelFor(agentOn('rerun', 'rerun-max', null)), prompt: 'summarise' })

        const request = sent()
        expect(request.url).toBe('https://hub.example.com/api/llm/chat/completions')
        expect(request.body.reasoning).toBeUndefined()
    })

    it('takes the model from the override but always the provider the agent resolved to', async () => {
        respondWith(CHAT_COMPLETION)

        await generateText({ model: modelFor(agentOn('rerun', 'rerun-max', null), { provider: 'openai', model: 'rerun-mini' }), prompt: 'summarise' })

        const request = sent()
        expect(request.url).toBe('https://hub.example.com/api/llm/chat/completions')
        expect(request.body.model).toBe('rerun-mini')
    })

    it('signs an anthropic call with the key of the connection', async () => {
        respondWith(ANTHROPIC_MESSAGE)

        await generateText({ model: modelFor(agentOn('anthropic', 'claude-opus-4-8', { ANTHROPIC_API_KEY: 'ant-key' })), prompt: 'hello' })

        const request = sent()
        expect(request.url).toBe('https://api.anthropic.com/v1/messages')
        expect(request.headers.get('x-api-key')).toBe('ant-key')
    })

    it('signs an openai call with the key of the connection', async () => {
        respondWith({})

        // Only the outgoing request matters here, not parsing a Responses API payload.
        await generateText({ model: modelFor(agentOn('openai', 'gpt-5', { OPENAI_API_KEY: 'oa-key' })), prompt: 'hello', maxRetries: 0 }).catch(() => undefined)

        const request = sent()
        expect(request.url).toBe('https://api.openai.com/v1/responses')
        expect(request.headers.get('authorization')).toBe('Bearer oa-key')
    })

    it('accepts the older GOOGLE_API_KEY name for a google connection', async () => {
        respondWith(GEMINI_RESPONSE)

        await generateText({ model: modelFor(agentOn('google', 'gemini-2.5-pro', { GOOGLE_API_KEY: 'g-key' })), prompt: 'hello' })

        expect(sent().headers.get('x-goog-api-key')).toBe('g-key')
    })

    // The comment on connectionEnv promises an agent with no connection fails rather than borrowing
    // an ambient key. The Anthropic SDK reads ANTHROPIC_API_KEY from process.env when apiKey is
    // undefined, so that promise only holds while the engine process carries no such variable.
    it('lets an agent with no connection fall through to an ambient ANTHROPIC_API_KEY', async () => {
        process.env.ANTHROPIC_API_KEY = 'ambient-key'
        respondWith(ANTHROPIC_MESSAGE)

        await generateText({ model: modelFor(agentOn('anthropic', 'claude-opus-4-8', null)), prompt: 'hello' })

        expect(sent().headers.get('x-api-key')).toBe('ambient-key')
    })

    it('builds the codex exec transport for one-shot calls, in the connection home', () => {
        const model = modelFor(agentOn('codex', 'gpt-5.5', { CODEX_OAUTH_TOKEN: 't' })) as any

        expect(model.modelId).toBe('gpt-5.5')
        expect(model.settings).toMatchObject({
            approvalMode: 'never',
            sandboxMode: 'danger-full-access',
            skipGitRepoCheck: true,
            codexPath: '/opt/codex/bin/codex',
            cwd: workspaceDir('agent-codex'),
            configOverrides: { ...CODEX_HARNESS_OVERRIDES, instructions: CODEX_ONE_SHOT_INSTRUCTIONS },
        })
        expect(model.settings.env).toMatchObject({ CODEX_HOME: codexHomeDir('codex-cnx'), AGENT_SECRET: 's', RERUN_WORKSPACE: workspaceDir('agent-codex'), PATH: process.env.PATH })
        expect(model.settings.env).toMatchObject({ RERUN_API_KEY: '', RERUN_HUB_BASE_URL: '', RERUN_DATA_DIR: '' })
    })

    it('reopens the named claude built-ins for that call alone', () => {
        const model = modelFor(agentOn('claude', 'opus', { CLAUDE_CODE_OAUTH_TOKEN: 'oauth' }), undefined, undefined, undefined, { claudeTools: ['WebSearch'] }) as any
        expect(model.settings.tools).toEqual(['WebSearch'])
        expect(model.settings).not.toHaveProperty('systemPrompt')
    })
})

describe('resolveModel on the claude subscription', () => {
    it('runs the CLI on the connection token, never on an API key, with the harness switched off', () => {
        resolveModel(agentOn('claude', 'opus', { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token' }), undefined, undefined, undefined, { system: 'You are Rerun.' })
        const settings = claudeCalls[0]!.defaultSettings

        expect(settings.systemPrompt).toBe('You are Rerun.')
        expect(settings.cwd).toBe(workspaceDir('agent-claude'))
        expect(settings.tools).toEqual(['WebSearch'])
        expect(settings.persistSession).toBe(false)
        expect(settings.env).toMatchObject({ ...CLAUDE_HARNESS_ENV, CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token', MCP_TOOL_TIMEOUT: '3600000', AGENT_SECRET: 's' })
        expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined()
        expect(settings).not.toHaveProperty('mcpServers')
    })

    it('exposes the bridged tools and reports no context occupancy before the run', () => {
        const tools = { fs_read: tool({ description: 'read', inputSchema: z.object({ path: z.string() }), execute: async () => 'ok' }) }
        const resolved = resolveModel(agentOn('claude', 'opus', { CLAUDE_CODE_OAUTH_TOKEN: 't' }), undefined, tools)
        const settings = claudeCalls[0]!.defaultSettings

        expect(settings.allowedTools).toEqual(['mcp__rerun__fs_read'])
        expect(Object.keys(settings.mcpServers)).toEqual(['rerun'])
        expect(resolved.contextUsage?.()).toBeUndefined()
    })

    it('opens no built-in at all for an agent without the web', () => {
        const agent = agentOn('claude', 'opus', { CLAUDE_CODE_OAUTH_TOKEN: 't' })
        agent.config.tools.web = false
        resolveModel(agent)
        expect(claudeCalls[0]!.defaultSettings.tools).toEqual([])
    })

    it('sends an empty token rather than none for a claude agent without a connection', () => {
        resolveModel(agentOn('claude', 'opus', null))
        const settings = claudeCalls[0]!.defaultSettings
        expect(settings.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('')
    })
})

describe('resolveModel on the codex subscription', () => {
    it('streams through the app-server, with the run prompt as its base instructions', async () => {
        const tools = { fs_read: tool({ description: 'read', inputSchema: z.object({ path: z.string() }), execute: async () => 'ok' }) }
        const resolved = resolveModel(agentOn('codex', 'gpt-5.5', { CODEX_OAUTH_TOKEN: 't' }), { model: 'gpt-5.5-mini' }, tools, [], { system: 'You are Rerun.' })

        expect((resolved.model as any).modelId).toBe('gpt-5.5-mini')
        expect(codexAppServerCalls).toHaveLength(1)
        const settings = codexAppServerCalls[0]!.defaultSettings
        expect(settings).toMatchObject({ baseInstructions: 'You are Rerun.', approvalPolicy: 'never', threadMode: 'persistent', codexPath: '/opt/codex/bin/codex', minCodexVersion: '0.144.0' })
        expect(settings.env.CODEX_HOME).toBe(codexHomeDir('codex-cnx'))
        expect(settings.configOverrides).not.toHaveProperty('instructions')
        expect(settings.configOverrides).toMatchObject({ ...CODEX_HARNESS_OVERRIDES, web_search: 'live', prefix_mcp_tool_names: true, 'mcp_servers.rerun.tool_timeout_sec': 3600, model_reasoning_summary: 'auto' })
        expect(Object.keys(settings.mcpServers)).toEqual(['rerun'])
        expect(resolved.contextUsage).toBeUndefined()
        await expect(resolved.close()).resolves.toBeUndefined()
    })

    it('keeps the web search off for an agent without the web', () => {
        const agent = agentOn('codex', 'gpt-5.5', { CODEX_OAUTH_TOKEN: 't' })
        agent.config.tools.web = false
        resolveModel(agent)
        expect(codexAppServerCalls[0]!.defaultSettings.configOverrides.web_search).toBe('disabled')
    })

    it("keeps Codex's own instructions when the run passes no prompt", async () => {
        const resolved = resolveModel(agentOn('codex', 'gpt-5.5', { CODEX_OAUTH_TOKEN: 't' }))
        expect(codexAppServerCalls[0]!.defaultSettings).not.toHaveProperty('baseInstructions')
        await resolved.close()
    })

    // Every agent on the keyless box shares the Rerun home rather than one of its own.
    it('falls back to the rerun connection home for a codex agent without a connection', async () => {
        const resolved = resolveModel(agentOn('codex', 'gpt-5.5', null))
        expect(codexAppServerCalls[0]!.defaultSettings.env.CODEX_HOME).toBe(codexHomeDir('rerun'))
        await resolved.close()
    })
})
