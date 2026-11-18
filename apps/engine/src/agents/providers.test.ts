import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { tool, dynamicTool, jsonSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import type { McpServer } from '@rerun/contracts'
import { CLAUDE_HARNESS_ENV, CODEX_DISABLED_FEATURES, CODEX_HARNESS_OVERRIDES, CODEX_SKILL_OVERRIDES, claudeAuthEnv, claudeBridgeHandler, claudeMcpConfig, codexMcpConfig, compactAtTokens, compactEnvFor, modelFor, resolveModel } from './providers.js'
import { askUserTool, canonicalBridgeName, canonicalHitlName, isHitlToolName, requestApprovalTool } from '../tools/builtin/hitl.js'

const captured = vi.hoisted(() => {
    process.env.RERUN_DATA_DIR = `${process.env.TMPDIR ?? '/tmp'}/rerun-providers-labels-${process.pid}`
    return { claude: [] as any[], codex: [] as any[] }
})

vi.mock('ai-sdk-provider-claude-code', async importOriginal => {
    const actual = await importOriginal<typeof import('ai-sdk-provider-claude-code')>()
    return { ...actual, createClaudeCode: (options: any) => (captured.claude.push(options?.defaultSettings), actual.createClaudeCode(options)) }
})

vi.mock('ai-sdk-provider-codex-cli', async importOriginal => {
    const actual = await importOriginal<typeof import('ai-sdk-provider-codex-cli')>()
    return {
        ...actual,
        createCodexExec: (options: any) => (captured.codex.push(options?.defaultSettings), actual.createCodexExec(options)),
        createCodexAppServer: (options: any) => (captured.codex.push(options?.defaultSettings), actual.createCodexAppServer(options)),
    }
})

const HITL_CTX = { agent: { config: { tools: { cards: true } } } } as any

function server(partial: Partial<McpServer> & { name: string }): McpServer {
    return { args: [], env: {}, headers: {}, ...partial }
}

describe('claudeMcpConfig', () => {
    it('maps a stdio server to a command entry and allows the whole server', () => {
        const stdio = server({ name: 'files', command: 'mcp-files', args: ['--root', '/tmp'], env: { TOKEN: 'x' } })
        const { mcpServers, allowedTools } = claudeMcpConfig(undefined, [stdio])
        expect(mcpServers.files).toEqual({ type: 'stdio', command: 'mcp-files', args: ['--root', '/tmp'], env: { TOKEN: 'x' } })
        expect(allowedTools).toContain('mcp__files')
    })

    it('maps an http server with headers', () => {
        const http = server({ name: 'api', transport: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer t' } })
        const { mcpServers, allowedTools } = claudeMcpConfig(undefined, [http])
        expect(mcpServers.api).toEqual({ type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer t' } })
        expect(allowedTools).toEqual(['mcp__api'])
    })

    it('maps an sse server', () => {
        const sse = server({ name: 'stream', transport: 'sse', url: 'https://mcp.example.com/sse' })
        const { mcpServers } = claudeMcpConfig(undefined, [sse])
        expect(mcpServers.stream).toEqual({ type: 'sse', url: 'https://mcp.example.com/sse', headers: {} })
    })

    it('bridges Zod builtin tools via the rerun in-process server, drops jsonSchema tools', () => {
        const tools: ToolSet = {
            fs_read: tool({ description: 'read', inputSchema: z.object({ path: z.string() }), execute: async () => 'ok' }),
            mcpish: dynamicTool({ description: 'json schema tool', inputSchema: jsonSchema({ type: 'object', properties: { a: { type: 'string' } } }), execute: async () => 'ok' }),
        }
        const { mcpServers, allowedTools } = claudeMcpConfig(tools, [])
        expect(mcpServers.rerun).toBeDefined()
        expect(allowedTools).toContain('mcp__rerun__fs_read')
        expect(allowedTools).not.toContain('mcp__rerun__mcpish')
    })

    it('hands a server the engine already holds to the CLI as an in-process relay under its own name', () => {
        const relay = { name: 'discord', tools: [], call: async () => ({ content: [] }) }
        const { mcpServers, allowedTools } = claudeMcpConfig(undefined, [{ ...server({ name: 'discord', command: 'npx', args: ['-y', 'mcp-discord'] }), relay }, server({ name: 'gh', url: 'https://gh.example/mcp' })])
        expect(mcpServers.discord).toMatchObject({ type: 'sdk', name: 'discord' })
        expect(mcpServers.gh).toEqual({ type: 'http', url: 'https://gh.example/mcp', headers: {} })
        expect(allowedTools).toEqual(['mcp__discord', 'mcp__gh'])
    })

    it('ignores servers with neither command nor url, and the reserved "rerun" name', () => {
        const broken = server({ name: 'broken' })
        const reserved = server({ name: 'rerun', command: 'x' })
        const { mcpServers, allowedTools } = claudeMcpConfig(undefined, [broken, reserved])
        expect(mcpServers).toEqual({})
        expect(allowedTools).toEqual([])
    })

    it('returns empty config when there is nothing to expose', () => {
        const { mcpServers, allowedTools } = claudeMcpConfig(undefined, [])
        expect(mcpServers).toEqual({})
        expect(allowedTools).toEqual([])
    })

    it('marks call_agent, and only call_agent, as a tool whose calls may overlap', () => {
        const tools: ToolSet = {
            call_agent: tool({ description: 'call', inputSchema: z.object({ agent: z.string() }), execute: async () => 'ok' }),
            fs_write: tool({ description: 'write', inputSchema: z.object({ path: z.string() }), execute: async () => 'ok' }),
        }
        const registered = (claudeMcpConfig(tools, []).mcpServers.rerun as any).instance._registeredTools
        expect(registered.call_agent.annotations).toEqual({ readOnlyHint: true })
        expect(registered.fs_write.annotations).toBeUndefined()
    })

    it('bridges ask_user without throwing (schema stays a plain ZodObject)', () => {
        expect(() => claudeMcpConfig(askUserTool(HITL_CTX), [])).not.toThrow()
        const { mcpServers, allowedTools } = claudeMcpConfig(askUserTool(HITL_CTX), [])
        expect(mcpServers.rerun).toBeDefined()
        expect(allowedTools).toContain('mcp__rerun__ask_user')
    })
})

describe('CLAUDE_HARNESS_ENV', () => {
    it('no longer disables compaction in the CLI', () => {
        expect(CLAUDE_HARNESS_ENV).not.toHaveProperty('DISABLE_AUTO_COMPACT')
        expect(CLAUDE_HARNESS_ENV).not.toHaveProperty('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE')
    })

    it('closes what would outlive the turn', () => {
        expect(CLAUDE_HARNESS_ENV.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe('1')
        expect(CLAUDE_HARNESS_ENV.CLAUDE_CODE_DISABLE_CRON).toBe('1')
    })

    it('holds environment variable names with a set value, since an empty one reads as off', () => {
        for (const [name, value] of Object.entries(CLAUDE_HARNESS_ENV)) {
            expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/)
            expect(value).toBe('1')
        }
    })
})

describe('compactAtTokens', () => {
    afterEach(() => {
        for (const size of ['SMALL', 'MEDIUM', 'LARGE']) delete process.env[`RERUN_COMPACT_AT_${size}`]
    })

    it('maps each size to its trigger point and defaults to small', () => {
        expect(compactAtTokens('small')).toBe(240000)
        expect(compactAtTokens('medium')).toBe(480000)
        expect(compactAtTokens('large')).toBe(940000)
        expect(compactAtTokens()).toBe(240000)
        expect(compactAtTokens('off')).toBeNull()
    })

    it('takes a point from the environment when it is an integer from 67000 to 967000, and ignores anything else', () => {
        process.env.RERUN_COMPACT_AT_SMALL = '300000'
        process.env.RERUN_COMPACT_AT_MEDIUM = '67000'
        process.env.RERUN_COMPACT_AT_LARGE = '967000'
        expect([compactAtTokens('small'), compactAtTokens('medium'), compactAtTokens('large')]).toEqual([300000, 67000, 967000])
        for (const bad of ['66999', '967001', '240000.5', 'abc', '', '-1']) {
            process.env.RERUN_COMPACT_AT_SMALL = bad
            expect(compactAtTokens('small')).toBe(240000)
        }
    })

    it('sets the window so the CLI trigger (window minus 20000 output reserve minus 13000 buffer) lands on the point', () => {
        expect(compactEnvFor(240000)).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '273000' })
        expect(compactEnvFor(480000)).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '513000' })
        expect(compactEnvFor(940000)).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '973000' })
        expect(compactEnvFor(null)).toEqual({ DISABLE_AUTO_COMPACT: '1' })
    })
})

describe('claudeAuthEnv', () => {
    it('declares the profile scope for a token from the sign-in flow, so the CLI reads the plan limits', () => {
        const env = claudeAuthEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'access', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh' })
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('access')
        expect(env.CLAUDE_CODE_OAUTH_SCOPES?.split(' ')).toContain('user:profile')
        expect(env.CLAUDE_CODE_OAUTH_SCOPES?.split(' ')).toContain('user:inference')
    })

    it('claims no scope for a pasted setup-token, which was never issued the profile one', () => {
        expect(claudeAuthEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'static' })).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'static', CLAUDE_CODE_OAUTH_SCOPES: undefined })
    })

    it('hands over an empty token when the connection has none', () => {
        expect(claudeAuthEnv({}).CLAUDE_CODE_OAUTH_TOKEN).toBe('')
    })
})

describe('CODEX_HARNESS_OVERRIDES', () => {
    it('closes the second prompt an AGENTS.md would be', () => {
        expect(CODEX_HARNESS_OVERRIDES.project_doc_max_bytes).toBe(0)
    })

    it('reports no usage back to OpenAI', () => {
        expect(CODEX_HARNESS_OVERRIDES['analytics.enabled']).toBe(false)
    })

    it('keeps the web search off for the one-shot calls, a run reopens it', () => {
        expect(CODEX_HARNESS_OVERRIDES.web_search).toBe('disabled')
    })

    it('leaves running a command to shell_exec, and still hands its variables to a shell it failed to close', () => {
        expect(CODEX_HARNESS_OVERRIDES['features.shell_tool']).toBe(false)
        expect(CODEX_HARNESS_OVERRIDES['features.unified_exec']).toBe(false)
        expect(CODEX_HARNESS_OVERRIDES['shell_environment_policy.ignore_default_excludes']).toBe(true)
    })

    it('carries the sub-agent and skill overrides, so the exec transport gets them too', () => {
        for (const feature of CODEX_DISABLED_FEATURES) expect(CODEX_HARNESS_OVERRIDES[`features.${feature}`]).toBe(false)
        for (const [key, value] of Object.entries(CODEX_SKILL_OVERRIDES)) expect(CODEX_HARNESS_OVERRIDES[key]).toBe(value)
    })

    it('keeps vision and image generation', () => {
        expect(CODEX_HARNESS_OVERRIDES['features.view_image']).toBeUndefined()
        expect(CODEX_HARNESS_OVERRIDES['features.image_generation']).toBeUndefined()
    })

    it('holds dotted config paths, so each key stays a valid config override', () => {
        for (const key of Object.keys(CODEX_HARNESS_OVERRIDES)) expect(key).toMatch(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
    })
})

describe('CODEX_DISABLED_FEATURES', () => {
    it('closes the native sub-agent feature', () => {
        expect(CODEX_DISABLED_FEATURES).toContain('multi_agent')
    })

    it('holds bare feature names, so each `features.<name>` key stays a valid config override', () => {
        for (const name of CODEX_DISABLED_FEATURES) expect(name).toMatch(/^[a-z0-9_]+$/)
    })
})

describe('CODEX_SKILL_OVERRIDES', () => {
    it('closes the native skill store, which takes skill writes outside the Rerun one', () => {
        expect(CODEX_SKILL_OVERRIDES['skills.bundled.enabled']).toBe(false)
        expect(CODEX_SKILL_OVERRIDES['skills.include_instructions']).toBe(false)
    })

    it('holds dotted config paths, so each key stays a valid config override', () => {
        for (const key of Object.keys(CODEX_SKILL_OVERRIDES)) expect(key).toMatch(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
    })
})

describe('codexMcpConfig', () => {
    it('maps a stdio server to a transport entry', () => {
        const stdio = server({ name: 'files', command: 'mcp-files', args: ['--root', '/tmp'], env: { TOKEN: 'x' } })
        expect(codexMcpConfig(undefined, [stdio]).files).toEqual({ transport: 'stdio', command: 'mcp-files', args: ['--root', '/tmp'], env: { TOKEN: 'x' } })
    })

    it('maps an http server, renaming headers to httpHeaders', () => {
        const http = server({ name: 'api', transport: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer t' } })
        expect(codexMcpConfig(undefined, [http]).api).toEqual({ transport: 'http', url: 'https://mcp.example.com', httpHeaders: { Authorization: 'Bearer t' } })
    })

    it('drops an sse server: Codex has no sse transport', () => {
        const sse = server({ name: 'stream', transport: 'sse', url: 'https://mcp.example.com/sse' })
        expect(codexMcpConfig(undefined, [sse])).toEqual({})
    })

    it('bridges Zod builtin tools via the rerun sdk server, drops jsonSchema tools', () => {
        const tools: ToolSet = {
            fs_read: tool({ description: 'read', inputSchema: z.object({ path: z.string() }), execute: async () => 'ok' }),
            mcpish: dynamicTool({ description: 'json schema tool', inputSchema: jsonSchema({ type: 'object', properties: { a: { type: 'string' } } }), execute: async () => 'ok' }),
        }
        const bridged = codexMcpConfig(tools, []).rerun as { tools: Array<{ name: string }> }
        expect(bridged.tools.map(t => t.name)).toEqual(['fs_read'])
    })

    it('ignores servers with neither command nor url, and the reserved "rerun" name', () => {
        const broken = server({ name: 'broken' })
        const reserved = server({ name: 'rerun', command: 'x' })
        expect(codexMcpConfig(undefined, [broken, reserved])).toEqual({})
    })

    it('returns empty config when there is nothing to expose', () => {
        expect(codexMcpConfig(undefined, [])).toEqual({})
    })

    it('bridges ask_user without throwing (schema stays a plain ZodObject)', () => {
        expect(() => codexMcpConfig(askUserTool(HITL_CTX), [])).not.toThrow()
        const bridged = codexMcpConfig(askUserTool(HITL_CTX), []).rerun as { tools: Array<{ name: string }> }
        expect(bridged.tools.map(t => t.name)).toEqual(['ask_user'])
    })
})

describe('codex bridge server', () => {
    type Sdk = { _start(): Promise<{ url: string; bearerToken: string }>; _stop(): Promise<void> }
    let sdk: Sdk
    let endpoint: { url: string; bearerToken: string }
    let nextId = 0

    const rpc = async (method: string, params: unknown): Promise<{ result?: any; error?: any }> => {
        const res = await fetch(endpoint.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.bearerToken}` },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
        })
        return res.json() as Promise<{ result?: any; error?: any }>
    }

    beforeAll(async () => {
        sdk = codexMcpConfig({ ...askUserTool(HITL_CTX), ...requestApprovalTool({} as any) }, []).rerun as unknown as Sdk
        endpoint = await sdk._start()
        await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    })

    afterAll(async () => {
        await sdk._stop()
    })

    it('advertises the bridged tools with a usable input schema', async () => {
        const { result } = await rpc('tools/list', {})
        const names = (result.tools as Array<{ name: string }>).map(t => t.name)
        expect(names).toEqual(['ask_user', 'request_approval'])

        const schema = (result.tools as Array<{ name: string; inputSchema: any }>).find(t => t.name === 'ask_user')!.inputSchema
        expect(schema.properties.questions.type).toBe('array')
        expect(schema.properties.questions.items.properties.question.type).toBe('string')
        expect(schema.properties.questions.items.properties.header).toBeDefined()
        expect(JSON.stringify(schema.properties.questions.items.properties.options)).toContain('"label"')

        const approvalSchema = (result.tools as Array<{ name: string; inputSchema: any }>).find(t => t.name === 'request_approval')!.inputSchema
        expect(approvalSchema.properties.approvals.type).toBe('array')
        expect(approvalSchema.properties.approvals.items.properties.action.type).toBe('string')
    })

    it('runs a bridged tool and returns its result', async () => {
        const { result } = await rpc('tools/call', { name: 'ask_user', arguments: { questions: [{ question: 'Ready?', options: ['Yes', 'No'] }] } })
        expect(JSON.parse(result.content[0].text).status).toBe('delivered')
    })

    it('runs a bridged ask_user whose options carry a header and descriptions', async () => {
        const questions = [{ question: 'Which format?', header: 'Format', options: [{ label: 'One-pager', description: 'A single page' }, 'Deck'] }]
        const { result } = await rpc('tools/call', { name: 'ask_user', arguments: { questions } })
        expect(JSON.parse(result.content[0].text).status).toBe('delivered')
    })

    it('still accepts a stringified array', async () => {
        const { result } = await rpc('tools/call', { name: 'ask_user', arguments: { questions: JSON.stringify([{ question: 'Ready?' }]) } })
        expect(JSON.parse(result.content[0].text).status).toBe('delivered')

        const approval = await rpc('tools/call', { name: 'request_approval', arguments: { approvals: JSON.stringify([{ action: 'Send it' }]) } })
        expect(JSON.parse(approval.result.content[0].text).status).toBe('delivered')
    })

    it('rejects input that does not match the schema', async () => {
        const { error } = await rpc('tools/call', { name: 'ask_user', arguments: { questions: 'not-an-array' } })
        expect(error.message).toContain('expected array')
    })

    it('refuses an unauthenticated call', async () => {
        const res = await fetch(endpoint.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }) })
        expect(res.status).toBe(401)
    })
})

describe('canonicalHitlName', () => {
    it.each(['mcp__rerun__ask_user', 'rerun__ask_user', 'ask_user'])('strips the bridge namespace from %s', name => {
        expect(canonicalHitlName(name)).toBe('ask_user')
        expect(isHitlToolName(name)).toBe(true)
    })

    it('leaves an unrelated tool name alone', () => {
        expect(canonicalHitlName('mcp__files__read')).toBe('mcp__files__read')
        expect(isHitlToolName('mcp__files__read')).toBe(false)
    })

    it('canonicalizes every Rerun bridge tool without touching external MCP tools', () => {
        expect(canonicalBridgeName('mcp__rerun__rerun_hub_service_search')).toBe('rerun_hub_service_search')
        expect(canonicalBridgeName('mcp__google-drive__gdrive_search')).toBe('mcp__google-drive__gdrive_search')
    })
})

describe('claudeBridgeHandler', () => {
    const bridged = (execute: (input: any, options: any) => Promise<unknown>) => tool({ description: 't', inputSchema: z.object({}).passthrough(), execute })

    it('hands the model the text a tool returned, a string as it is and anything else as JSON', async () => {
        expect(await claudeBridgeHandler(bridged(async () => 'plain'))({}, {})).toEqual({ content: [{ type: 'text', text: 'plain' }] })
        expect(await claudeBridgeHandler(bridged(async () => ({ ok: true })))({}, undefined)).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] })
        expect(await claudeBridgeHandler(bridged(async () => undefined))({}, {})).toEqual({ content: [{ type: 'text', text: 'undefined' }] })
        expect(await claudeBridgeHandler(bridged(async () => null))({}, {})).toEqual({ content: [{ type: 'text', text: 'null' }] })
    })

    it('passes the arguments, the request id and the stop signal of the call through to the tool', async () => {
        const seen: any[] = []
        const handler = claudeBridgeHandler(
            bridged(async (input, options) => {
                seen.push({ input, options })
                return 'ok'
            }),
        )
        const signal = new AbortController().signal
        await handler({ path: 'a' }, { requestId: 7, signal })
        await handler({ path: 'b' }, {})
        expect(seen[0]).toMatchObject({ input: { path: 'a' }, options: { toolCallId: '7', abortSignal: signal } })
        expect(seen[1].options.toolCallId).toEqual(expect.any(String))
    })

    it('attaches the picture of a screenshot the run still holds, and only then', async () => {
        const screenshots = (id: string) => (id === 'kept' ? { image: Buffer.from('jpeg-bytes'), mediaType: 'image/jpeg' } : undefined)
        const kept = await claudeBridgeHandler(bridged(async () => ({ status: 'done', screenshotId: 'kept' })), screenshots)({}, {})
        expect(kept.content).toEqual([
            { type: 'text', text: '{"status":"done","screenshotId":"kept"}' },
            { type: 'image', data: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' },
        ])
        expect((await claudeBridgeHandler(bridged(async () => ({ screenshotId: 'dropped' })), screenshots)({}, {})).content).toHaveLength(1)
        expect((await claudeBridgeHandler(bridged(async () => ({ screenshotId: 'kept' })))({}, {})).content).toHaveLength(1)
        expect((await claudeBridgeHandler(bridged(async () => ({ screenshotId: 12 })), screenshots)({}, {})).content).toHaveLength(1)
    })

    it('reports a tool that threw as an error result rather than breaking the bridge', async () => {
        const failing = bridged(async () => {
            throw new Error('disk full')
        })
        expect(await claudeBridgeHandler(failing)({}, {})).toEqual({ isError: true, content: [{ type: 'text', text: 'disk full' }] })
        const odd = bridged(async () => {
            throw 'plain'
        })
        expect(await claudeBridgeHandler(odd)({}, {})).toEqual({ isError: true, content: [{ type: 'text', text: 'plain' }] })
    })
})

describe('labels reach the CLI processes', () => {
    const labelled = { RERUN_RUN_ID: 'run-1', RERUN_COWORKER: 'Code' }
    const agentFor = (provider: 'claude' | 'codex') =>
        ({
            id: 'labels-agent',
            env: {},
            config: { name: 'Labels', tools: { sharedDb: false } },
            resolved: { provider, model: 'some-model', connection: undefined },
        }) as any

    it('puts them in the Claude CLI env, and leaves them out when omitted', async () => {
        captured.claude.length = 0
        const { close } = resolveModel(agentFor('claude'), undefined, undefined, undefined, { labels: labelled })
        await close()
        resolveModel(agentFor('claude'))
        expect(captured.claude[0].env.RERUN_RUN_ID).toBe('run-1')
        expect(captured.claude[0].env.RERUN_COWORKER).toBe('Code')
        expect(captured.claude[1].env.RERUN_RUN_ID).toBeUndefined()
    })

    it('puts them in the Codex app-server env overlay, and leaves them out when omitted', async () => {
        captured.codex.length = 0
        const withLabels = resolveModel(agentFor('codex'), undefined, undefined, undefined, { labels: labelled })
        const without = resolveModel(agentFor('codex'))
        await withLabels.close()
        await without.close()
        expect(captured.codex[0].env.RERUN_RUN_ID).toBe('run-1')
        expect(captured.codex[1].env.RERUN_RUN_ID).toBeUndefined()
    })

    it('puts them in the Codex exec env overlay of a one-shot call', () => {
        captured.codex.length = 0
        modelFor({ ...agentFor('codex') }, undefined, undefined, undefined, { labels: labelled })
        expect(captured.codex.some(settings => settings.env.RERUN_RUN_ID === 'run-1')).toBe(true)
    })
})

describe('thinking level reaches the Claude CLI', () => {
    const agentWith = (thinkingLevel?: string) =>
        ({ id: 'think-agent', env: {}, config: { name: 'T', tools: { sharedDb: false }, ...(thinkingLevel ? { thinkingLevel } : {}) }, resolved: { provider: 'claude', model: 'm', connection: undefined } }) as any

    it('keeps the adaptive default when unset and adds the effort when set', () => {
        captured.claude.length = 0
        resolveModel(agentWith())
        resolveModel(agentWith('high'))
        expect(captured.claude[0].thinking).toEqual({ type: 'adaptive', display: 'summarized' })
        expect(captured.claude[1].thinking).toEqual({ type: 'adaptive', display: 'summarized' })
        expect(captured.claude[0].effort).toBeUndefined()
        expect(captured.claude[1].effort).toBe('high')
    })
})
