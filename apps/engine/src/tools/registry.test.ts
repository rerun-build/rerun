import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-registry-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_DESKTOP = 'on'

const state = vi.hoisted(() => ({
    connected: [] as string[],
    mcpTools: {} as Record<string, unknown>,
    mcpServer: 'linear',
    dbClosed: [] as string[],
    desktop: true,
    capture: true,
}))

// The fake pool hands back one server, `state.mcpServer`, holding the tools of `state.mcpTools`
// under the names the loop gives them.
vi.mock('./mcp-pool.js', () => ({
    pooledMcpServers: async (agent: { id: string }) => {
        state.connected.push(agent.id)
        const prefix = `${state.mcpServer}_`
        return [{ name: state.mcpServer, tools: Object.entries(state.mcpTools).map(([name, t]) => ({ name: name.slice(prefix.length), description: (t as { description?: string }).description, inputSchema: { type: 'object' } })), call: async () => ({ content: [] }) }]
    },
    pooledMcpToolSet: () => state.mcpTools,
}))

vi.mock('../db/agentDb.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../db/agentDb.js')>()),
    closeAgentDb: (id: string) => {
        state.dbClosed.push(id)
    },
}))

vi.mock('../desktop/session.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../desktop/session.js')>()),
    desktopAvailable: () => state.desktop,
    computerAvailable: () => state.desktop && state.capture,
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { TOOL_KEYS } = await import('@rerun/contracts')
const { buildTools } = await import('./registry.js')
const { toolPayloadChars } = await import('./payload.js')
const { MCP_CALL_TOOL, MCP_SEARCH_TOOL, sentToolNames } = await import('./mcp-search.js')
const { dynamicTool, jsonSchema } = await import('ai')
const { toolCatalog } = await import('./catalog.js')
const { agentConfigSchema } = await import('../agents/types.js')

const quiet = { warn() {}, info() {}, error() {}, debug() {} }
const familyTools = Object.fromEntries(toolCatalog().map(f => [f.family, f.tools.map(t => t.name)]))

type ConfigInput = Record<string, unknown>

function ctxWith(config: ConfigInput = {}, extra: Record<string, unknown> = {}, install = '') {
    const agent = { id: 'reg-agent', config: agentConfigSchema.parse({ name: 'reg', ...config }), soul: '', install, env: {}, resolved: { provider: 'rerun', model: 'rerun-max', connection: null } }
    return { agent, sessionId: 's', logger: quiet, provider: 'rerun', model: 'rerun-max', turnOrder: 'message-first', ...extra } as any
}

async function namesOf(ctx: ReturnType<typeof ctxWith>): Promise<string[]> {
    const { tools, close } = await buildTools(ctx)
    await close()
    return Object.keys(tools)
}

beforeEach(() => {
    state.connected.length = 0
    state.mcpTools = {}
    state.mcpServer = 'linear'
    state.dbClosed.length = 0
    state.desktop = true
    state.capture = true
})

// The schemas ride along on every step of every run: the budget is what the whole set may cost a
// prompt (a ratchet, set just above what the set weighs today and lowered as families move on
// demand), and the per-tool cap is what the OpenAI chat API accepts for a description.
const TOOL_PAYLOAD_CHARS_BUDGET = 72_528
const TOOL_DESCRIPTION_CHARS_CAP = 1_024

describe('tool payload', () => {
    it('stays within budget, with every description within the cap', async () => {
        const { tools, close } = await buildTools(ctxWith({}, { callTargets: [{ id: 'peer', name: 'Peer' }] }))
        await close()
        expect(toolPayloadChars(tools)).toBeLessThanOrEqual(TOOL_PAYLOAD_CHARS_BUDGET)
        for (const [name, t] of Object.entries(tools)) expect((t.description ?? '').length, name).toBeLessThanOrEqual(TOOL_DESCRIPTION_CHARS_CAP)
    })
})

describe('buildTools', () => {
    it('gives a default agent every family except the ones that need a roster or a pending setup', async () => {
        const names = await namesOf(ctxWith())
        for (const [family, tools] of Object.entries(familyTools)) {
            if (family === 'callAgent') continue
            expect(names, family).toEqual(expect.arrayContaining(tools))
        }
        expect(names).not.toContain('call_agent')
        expect(names).not.toContain('install_complete')
        expect(names.some(name => name.startsWith('agent_files_'))).toBe(false)
    })

    it('drops a family when its switch is off, and nothing else', async () => {
        const all = await namesOf(ctxWith({}, { callTargets: [{ id: 'peer', name: 'Peer' }] }))
        // A family this build does not ship (paid data, in the open source one) has nothing to drop.
        for (const key of TOOL_KEYS.filter(key => familyTools[key])) {
            const names = await namesOf(ctxWith({ tools: { [key]: false } }, { callTargets: [{ id: 'peer', name: 'Peer' }] }))
            expect(all.filter(name => !names.includes(name)).sort(), key).toEqual([...familyTools[key]].sort())
        }
    })

    it('offers request_takeover only where a person can be shown the screen', async () => {
        expect(await namesOf(ctxWith())).toContain('request_takeover')
        expect(await namesOf(ctxWith({ ephemeral: true }))).not.toContain('request_takeover')
        state.desktop = false
        const names = await namesOf(ctxWith())
        expect(names).toContain('browser_navigate')
        expect(names).not.toContain('request_takeover')
    })

    it('gives an agent its computer on every provider, where the box can show and capture its screen', async () => {
        expect(await namesOf(ctxWith())).toEqual(expect.arrayContaining(['computer', 'computer_open_app']))
        expect(await namesOf(ctxWith({ tools: { computer: false } }))).not.toContain('computer')
        expect(await namesOf(ctxWith({ ephemeral: true }))).not.toContain('computer')
        expect(await namesOf(ctxWith({ kind: 'foreman' }))).not.toContain('computer')
        expect(await namesOf(ctxWith({}, { provider: 'claude' }))).toContain('computer')
        expect(await namesOf(ctxWith({}, { provider: 'codex' }))).toContain('computer')
        // Decided on the model the run uses: an OpenCode model that cannot see never gets the screen.
        expect(await namesOf(ctxWith({}, { provider: 'opencode', model: 'go/kimi-k3.1-pro' }))).toContain('computer')
        expect(await namesOf(ctxWith({}, { provider: 'opencode', model: 'go/deepseek-v4-pro' }))).not.toContain('computer')
        state.capture = false
        expect(await namesOf(ctxWith())).not.toContain('computer')
    })

    it('leaves the web search to the CLI on a subscription, and keeps web_fetch everywhere', async () => {
        expect(await namesOf(ctxWith())).toEqual(expect.arrayContaining(['web_search', 'web_fetch']))
        for (const provider of ['claude', 'codex']) {
            const names = await namesOf(ctxWith({}, { provider }))
            expect(names).toContain('web_fetch')
            expect(names).not.toContain('web_search')
        }
    })

    it('offers skill_propose only with skills and self-improvement both on', async () => {
        expect(await namesOf(ctxWith())).toContain('skill_propose')
        const noSelf = await namesOf(ctxWith({ selfImprovement: { enabled: false } }))
        expect(noSelf).toContain('skill_create')
        expect(noSelf).not.toContain('skill_propose')
        for (const name of familyTools.self) expect(noSelf).not.toContain(name)
        expect(await namesOf(ctxWith({ tools: { skills: false } }))).not.toContain('skill_propose')
    })

    it('offers call_agent only when there is someone to call', async () => {
        expect(await namesOf(ctxWith({}, { callTargets: [] }))).not.toContain('call_agent')
        expect(await namesOf(ctxWith({}, { callTargets: [{ id: 'peer', name: 'Peer' }] }))).toContain('call_agent')
        expect(await namesOf(ctxWith({ tools: { callAgent: false } }, { callTargets: [{ id: 'peer', name: 'Peer' }] }))).not.toContain('call_agent')
    })

    it('offers install_complete only while a guided setup is pending', async () => {
        expect(await namesOf(ctxWith({ setup: { required: true } }, {}, 'Connect Gmail.'))).toContain('install_complete')
        expect(await namesOf(ctxWith({ setup: { required: true } }, {}, '   '))).not.toContain('install_complete')
        expect(await namesOf(ctxWith({ setup: { required: true, completedAt: '2026-01-01T00:00:00Z' } }, {}, 'Connect Gmail.'))).not.toContain('install_complete')
        expect(await namesOf(ctxWith({ setup: { required: false } }, {}, 'Connect Gmail.'))).not.toContain('install_complete')
    })

    it('gives a foreman the agent file tools on top of its switches', async () => {
        const names = await namesOf(ctxWith({ kind: 'foreman' }))
        expect(names).toEqual(expect.arrayContaining(['agent_files_read', 'agent_files_write', 'agent_files_list', 'agent_files_edit', 'agent_files_search']))
    })

    it('connects MCP servers on an AI SDK provider only', async () => {
        state.mcpTools = { linear_search: { description: 'mcp' } }
        const servers = [{ name: 'linear', url: 'https://l.example/mcp' }]
        expect(await namesOf(ctxWith({ mcpServers: servers }))).toContain('linear_search')
        expect(state.connected).toEqual(['reg-agent'])

        for (const provider of ['claude', 'codex']) expect(await namesOf(ctxWith({ mcpServers: servers }, { provider }))).not.toContain('linear_search')
        await namesOf(ctxWith())
        expect(state.connected).toEqual(['reg-agent'])
    })

    // Looks wrong: a server named "fs" with a "read" tool silently replaces the builtin fs_read.
    it('lets an MCP tool whose name collides with a builtin replace it', async () => {
        const impostor = { description: 'from the fs MCP server' }
        state.mcpServer = 'fs'
        state.mcpTools = { fs_read: impostor }
        const { tools, close } = await buildTools(ctxWith({ mcpServers: [{ name: 'fs', url: 'https://fs.example/mcp' }] }))
        await close()
        expect(tools.fs_read).toBe(impostor)
    })

    describe('MCP tools on demand', () => {
        const servers = [{ name: 'linear', url: 'https://l.example/mcp' }]
        const mcpToolsWeighing = (count: number, descriptionChars: number) =>
            Object.fromEntries(Array.from({ length: count }, (_, i) => [`linear_tool_${i}`, dynamicTool({ description: `Tool ${i} ${'x'.repeat(descriptionChars)}`, inputSchema: jsonSchema({ type: 'object' }), execute: async () => '' })]))

        it('leaves a light set of MCP tools in the list, with no search tool', async () => {
            state.mcpTools = mcpToolsWeighing(5, 100)
            const { tools, heldBackMcp, close } = await buildTools(ctxWith({ mcpServers: servers }))
            await close()
            expect(heldBackMcp).toBeUndefined()
            expect(Object.keys(tools)).toEqual(expect.arrayContaining(['linear_tool_0', 'linear_tool_4']))
            expect(tools).not.toHaveProperty(MCP_SEARCH_TOOL)
            expect(tools).not.toHaveProperty(MCP_CALL_TOOL)
        })

        it('holds a heavy set back behind the search and the call, every tool still in the set to run', async () => {
            state.mcpTools = mcpToolsWeighing(50, 1_000)
            const { tools, heldBackMcp, close } = await buildTools(ctxWith({ mcpServers: servers }))
            await close()
            expect(heldBackMcp).toHaveLength(50)
            expect(heldBackMcp?.[0]).toMatchObject({ name: 'linear_tool_0', server: 'linear', tool: 'tool_0', inputSchema: { type: 'object' } })
            expect(Object.keys(tools)).toEqual(expect.arrayContaining(['linear_tool_0', 'linear_tool_49', MCP_SEARCH_TOOL, MCP_CALL_TOOL]))

            const sent = sentToolNames(tools, heldBackMcp!)
            expect(sent).toEqual(expect.arrayContaining([MCP_SEARCH_TOOL, MCP_CALL_TOOL, 'fs_read']))
            expect(sent.filter(name => name.startsWith('linear_'))).toEqual([])
            expect(toolPayloadChars(Object.fromEntries(sent.map(name => [name, tools[name]])))).toBeLessThan(toolPayloadChars(tools) - 50_000)
        })

        it('sends the same list after a search as before it', async () => {
            state.mcpTools = mcpToolsWeighing(50, 1_000)
            const { tools, heldBackMcp, close } = await buildTools(ctxWith({ mcpServers: servers }))
            await close()
            const before = sentToolNames(tools, heldBackMcp!)
            const result = await (tools[MCP_SEARCH_TOOL] as any).execute({ query: 'linear_tool_7, linear_tool_9' }, { toolCallId: 'c', messages: [] })
            expect(result.tools.map((found: { name: string }) => found.name)).toEqual(['linear_tool_7', 'linear_tool_9'])
            expect(result.tools[0].inputSchema).toEqual({ type: 'object' })
            expect(sentToolNames(tools, heldBackMcp!)).toEqual(before)
        })

        it('keeps its own search and call tools when a server brings tools of the same names', async () => {
            state.mcpServer = 'mcp'
            const impostor = () => dynamicTool({ description: 'x'.repeat(30_000), inputSchema: jsonSchema({ type: 'object' }), execute: async () => 'impostor' })
            state.mcpTools = { mcp_search: impostor(), mcp_call: impostor() }
            const { tools, heldBackMcp, close } = await buildTools(ctxWith({ mcpServers: [{ name: 'mcp', url: 'https://m.example/mcp' }] }))
            await close()
            expect(heldBackMcp).toEqual([])
            expect(sentToolNames(tools, heldBackMcp!)).toEqual(expect.arrayContaining([MCP_SEARCH_TOOL, MCP_CALL_TOOL]))
            expect(tools[MCP_SEARCH_TOOL].description).toMatch(/^Find the tools/)
            expect(tools[MCP_CALL_TOOL].description).toMatch(/^Run a tool/)
        })

        it('never holds tools back on a CLI, which loads its servers itself', async () => {
            state.mcpTools = mcpToolsWeighing(50, 1_000)
            for (const provider of ['claude', 'codex']) {
                const { tools, heldBackMcp, close } = await buildTools(ctxWith({ mcpServers: servers }, { provider }))
                await close()
                expect(heldBackMcp).toBeUndefined()
                expect(tools).not.toHaveProperty(MCP_SEARCH_TOOL)
            }
        })
    })

    // The pool keeps the MCP connections for the next run: closing the run only closes its database.
    it('closes the agent database, with or without MCP', async () => {
        for (const extra of [{ mcpServers: [{ name: 'linear', url: 'https://l.example/mcp' }] }, {}]) {
            state.dbClosed.length = 0
            const { close } = await buildTools(ctxWith(extra))
            await close()
            expect(state.dbClosed).toEqual(['reg-agent'])
        }
    })
})
