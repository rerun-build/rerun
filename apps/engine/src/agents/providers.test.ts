import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tool, dynamicTool, jsonSchema, type ToolSet } from 'ai'
import { z } from 'zod'
import type { McpServer } from '@rerun/contracts'
import { CLAUDE_HARNESS_ENV, CODEX_DISABLED_FEATURES, CODEX_HARNESS_OVERRIDES, CODEX_SKILL_OVERRIDES, claudeAuthEnv, claudeBridgeHandler, claudeMcpConfig, codexMcpConfig } from './providers.js'
import { askUserTool, canonicalBridgeName, canonicalHitlName, isHitlToolName, requestApprovalTool } from '../tools/builtin/hitl.js'

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

    // The engine holds the connection: the CLI gets an in-process relay under the same name, so the
    // tools keep their `mcp__<server>__<tool>` names and the allow list does not change.
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

    it('bridges ask_user without throwing (schema stays a plain ZodObject)', () => {
        expect(() => claudeMcpConfig(askUserTool(HITL_CTX), [])).not.toThrow()
        const { mcpServers, allowedTools } = claudeMcpConfig(askUserTool(HITL_CTX), [])
        expect(mcpServers.rerun).toBeDefined()
        expect(allowedTools).toContain('mcp__rerun__ask_user')
    })
})

describe('CLAUDE_HARNESS_ENV', () => {
    it('leaves compaction to the engine', () => {
        expect(CLAUDE_HARNESS_ENV.DISABLE_AUTO_COMPACT).toBe('1')
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

    it('keeps the rerun tools direct model tools when the catalog forces code mode only', () => {
        expect(CODEX_HARNESS_OVERRIDES['features.code_mode.enabled']).toBe(false)
        expect(CODEX_HARNESS_OVERRIDES).not.toHaveProperty('features.code_mode')
        expect(CODEX_HARNESS_OVERRIDES['features.code_mode.direct_only_tool_namespaces']).toEqual(['mcp__rerun'])
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

// The bridge is a real MCP server over loopback HTTP, so the only honest check that Rerun's tools
// survive the AI SDK -> Codex conversion is to speak MCP to it. Guards the schema conversion of
// ask_user in particular: its `z.preprocess` wrapper is the fragile part.
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

    // jsonTolerantArray's safety net has to survive the conversion, or a model that stringifies the
    // array would break HITL on Codex while still working on Claude.
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

// Claude Code always prefixes `mcp__`; Codex only does when `prefix_mcp_tool_names` is on.
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
