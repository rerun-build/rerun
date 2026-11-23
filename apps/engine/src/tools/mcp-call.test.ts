import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-call-'))
process.env.RERUN_LOG_LEVEL = 'fatal'

const { describe, expect, it } = await import('vitest')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js')
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
const { callMcpTool } = await import('./mcp.js')
const { relayMcpServer } = await import('./mcp-relay.js')
const { MCP_TOOL_CALL_OPTIONS } = await import('./mcp-pool.js')

type CallResult = Awaited<ReturnType<typeof callMcpTool>>

// generate as @felores/kie-ai-mcp-server@5.6.2 lists it: a task_id promised, and an error result that
// carries `{ success, tool, error }` instead, which Kie.ai answered on a TikTok image (RER-148).
const GENERATE = {
    name: 'generate',
    inputSchema: { type: 'object' as const, properties: { prompt: { type: 'string' } } },
    outputSchema: { type: 'object' as const, properties: { task_id: { type: 'string' } }, required: ['task_id'], additionalProperties: false },
}
const REFUSED: CallResult = {
    isError: true,
    content: [{ type: 'text', text: '{"success":false,"tool":"generate","error":"File type not supported"}' }],
    structuredContent: { success: false, tool: 'generate', error: 'File type not supported' },
}
const STARTED: CallResult = { content: [{ type: 'text', text: '{"task_id":"abc"}' }], structuredContent: { task_id: 'abc' } }

async function link(server: { connect: (transport: InstanceType<typeof InMemoryTransport>) => Promise<void> }) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)
    const client = new Client({ name: 'rerun-engine', version: '1.0.0' })
    await client.connect(clientSide)
    await client.listTools()
    return client
}

async function kieClient(answer: CallResult) {
    const server = new Server({ name: 'kie-ai', version: '5.6.2' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [GENERATE] }))
    server.setRequestHandler(CallToolRequestSchema, async () => answer)
    return link(server)
}

describe('callMcpTool', () => {
    it("is needed: the SDK's callTool turns an error result that breaks the output schema into a schema mismatch", async () => {
        const client = await kieClient(REFUSED)
        await expect(client.callTool({ name: 'generate', arguments: {} })).rejects.toThrow("Structured content does not match the tool's output schema")
    })

    it("hands back the server's own error, without the structured part that breaks the schema", async () => {
        const client = await kieClient(REFUSED)
        expect(await callMcpTool(client, 'generate', {})).toEqual({ isError: true, content: REFUSED.content })
    })

    it('hands back a result that keeps to the schema as the server sent it', async () => {
        const client = await kieClient(STARTED)
        expect(await callMcpTool(client, 'generate', {})).toEqual(STARTED)
    })

    // The relay lists the tool without its output schema, which a result it cuts could not meet.
    it('lets the CLI behind the relay read the reason', async () => {
        const kie = await kieClient(REFUSED)
        const { instance } = relayMcpServer({ agentId: 'kie-agent', name: 'kie-ai', tools: [GENERATE], call: (name, args) => callMcpTool(kie, name, args) }, { timeout: 1234 })
        const cli = await link(instance)

        expect((await cli.listTools()).tools[0].outputSchema).toBeUndefined()
        expect(await cli.callTool({ name: 'generate', arguments: {} })).toEqual({ isError: true, content: REFUSED.content })
    })
})

// RER-243: Apify's call-actor runs as long as its actor does. The wait only gives up on a server that
// has gone quiet, never on one still reporting progress.
describe('the wait on a call', () => {
    const SILENCE_MS = 400
    const WORK_MS = 1200

    async function jobClient(progressEveryMs: number | null) {
        const server = new Server({ name: 'apify', version: '1.0.0' }, { capabilities: { tools: {} } })
        server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'call-actor', inputSchema: { type: 'object' as const } }] }))
        server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            const progressToken = request.params._meta?.progressToken
            const started = Date.now()
            while (Date.now() - started < WORK_MS) {
                await new Promise(resolve => setTimeout(resolve, progressEveryMs ?? WORK_MS))
                if (progressEveryMs !== null && progressToken !== undefined) await extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress: Date.now() - started } })
            }
            return { content: [{ type: 'text' as const, text: 'actor finished' }] }
        })
        return link(server)
    }

    it('keeps waiting on a server that reports progress past the silence it allows', async () => {
        const client = await jobClient(50)
        expect(await callMcpTool(client, 'call-actor', {}, { ...MCP_TOOL_CALL_OPTIONS, timeout: SILENCE_MS })).toEqual({ content: [{ type: 'text', text: 'actor finished' }] })
    })

    it('gives up on a server that stays silent', async () => {
        const client = await jobClient(null)
        await expect(callMcpTool(client, 'call-actor', {}, { ...MCP_TOOL_CALL_OPTIONS, timeout: SILENCE_MS })).rejects.toThrow('Request timed out')
    })
})
