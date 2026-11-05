import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-relay-'))
process.env.RERUN_LOG_LEVEL = 'fatal'

const pool = vi.hoisted(() => ({ reachable: new Set<string>(), acquired: [] as Array<{ agentId: string; name: string; cwd: string }> }))

vi.mock('./mcp-pool.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./mcp-pool.js')>()),
    acquireMcp: async (agentId: string, server: { name: string }, spawn: { cwd: string }) => {
        pool.acquired.push({ agentId, name: server.name, cwd: spawn.cwd })
        return pool.reachable.has(server.name) ? { name: server.name, tools: [], call: async () => ({ content: [] }) } : null
    },
}))

const { describe, expect, it } = await import('vitest')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
const { relayMcpServer, withPooledRelays } = await import('./mcp-relay.js')
const { workspaceDir } = await import('../config/paths.js')

type Relay = Parameters<typeof relayMcpServer>[0]

async function clientOf(relay: Relay) {
    const { instance } = relayMcpServer(relay, 1234)
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await instance.connect(serverSide)
    const client = new Client({ name: 'cli', version: '1.0.0' })
    await client.connect(clientSide)
    return client
}

// send_email as mcp-mail-server@2.1.2 lists it on an engine box: the root anyOf kept it away from the
// model of every claude agent carrying the Email (IMAP/SMTP) app.
const SIGNATURE = {
    type: 'object',
    anyOf: [{ required: ['text'] }, { required: ['html'] }],
    properties: { text: { type: 'string', minLength: 1 }, html: { type: 'string', minLength: 1 } },
    additionalProperties: false,
}
const SEND_EMAIL_PROPERTIES = {
    to: { type: 'string', minLength: 1, maxLength: 8192 },
    subject: { type: 'string', minLength: 1, maxLength: 998 },
    text: { type: 'string', minLength: 1, maxLength: 10000000 },
    html: { type: 'string', minLength: 1, maxLength: 10000000 },
    signature: SIGNATURE,
}
const SEND_EMAIL = {
    name: 'send_email',
    description: 'Send a new email via SMTP.',
    inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        anyOf: [{ required: ['text'] }, { required: ['html'] }],
        type: 'object' as const,
        properties: SEND_EMAIL_PROPERTIES,
        required: ['to', 'subject'],
        additionalProperties: false,
    },
}

describe('relayMcpServer', () => {
    it('lists a tool without a root union exactly as the server did', async () => {
        const inputSchema = { type: 'object' as const, properties: { channel: { type: 'string', oneOf: [{ minLength: 1 }] } } }
        const client = await clientOf({ name: 'discord', tools: [{ name: 'send', description: 'Send a message', inputSchema }], call: async () => ({ content: [] }) })
        expect((await client.listTools()).tools).toEqual([{ name: 'send', description: 'Send a message', inputSchema }])
    })

    it('lifts a root oneOf and tells the model the rule in the description', async () => {
        const inputSchema = { type: 'object' as const, properties: { channel: { type: 'string' }, user: { type: 'string' } }, oneOf: [{ required: ['channel'] }, { required: ['user'] }] }
        const client = await clientOf({ name: 'discord', tools: [{ name: 'send', description: 'Send a message', inputSchema }], call: async () => ({ content: [] }) })
        expect((await client.listTools()).tools).toEqual([
            { name: 'send', description: 'Send a message\n\nProvide exactly one of: channel, user.', inputSchema: { type: 'object', properties: inputSchema.properties } },
        ])
    })

    it('lists the mail server send_email without its root anyOf, the nested one kept', async () => {
        const client = await clientOf({ name: 'email', tools: [SEND_EMAIL], call: async () => ({ content: [] }) })
        expect((await client.listTools()).tools).toEqual([
            {
                name: 'send_email',
                description: 'Send a new email via SMTP.\n\nProvide at least one of: text, html.',
                inputSchema: {
                    $schema: 'http://json-schema.org/draft-07/schema#',
                    type: 'object',
                    properties: SEND_EMAIL_PROPERTIES,
                    required: ['to', 'subject'],
                    additionalProperties: false,
                },
            },
        ])
    })

    it('passes each call on to the pooled connection, with the tool timeout', async () => {
        const calls: unknown[] = []
        const client = await clientOf({
            name: 'discord',
            tools: [{ name: 'send', inputSchema: { type: 'object' } }],
            call: async (name, args, options) => {
                calls.push({ name, args, timeout: options?.timeout })
                return { content: [{ type: 'text', text: 'sent' }] }
            },
        })
        expect(await client.callTool({ name: 'send', arguments: { text: 'hi' } })).toEqual({ content: [{ type: 'text', text: 'sent' }] })
        expect(calls).toEqual([{ name: 'send', args: { text: 'hi' }, timeout: 1234 }])
    })

    it('turns a failed call into a tool error the model can read', async () => {
        const client = await clientOf({
            name: 'discord',
            tools: [{ name: 'send', inputSchema: { type: 'object' } }],
            call: async () => {
                throw new Error('connection closed')
            },
        })
        expect(await client.callTool({ name: 'send', arguments: {} })).toEqual({ isError: true, content: [{ type: 'text', text: 'connection closed' }] })
    })

    it('passes a call without arguments as an empty object, and reads any thrown value', async () => {
        const seen: unknown[] = []
        const client = await clientOf({
            name: 'discord',
            tools: [{ name: 'ping', inputSchema: { type: 'object' } }],
            call: async (_name, args) => {
                seen.push(args)
                throw 'gone'
            },
        })
        expect(await client.callTool({ name: 'ping' })).toEqual({ isError: true, content: [{ type: 'text', text: 'gone' }] })
        expect(seen).toEqual([{}])
    })
})

describe('withPooledRelays', () => {
    it('relays the servers the pool reaches and leaves the others as declared', async () => {
        pool.reachable.add('discord')
        const agent = { id: 'relay-agent', env: {}, config: { tools: {} } } as never
        const servers = [
            { name: 'discord', command: 'npx', args: [], env: {}, headers: {} },
            { name: 'down', url: 'https://down.example/mcp', args: [], env: {}, headers: {} },
        ]
        const relayed = await withPooledRelays(agent, servers)
        expect(relayed[0]!.relay?.name).toBe('discord')
        expect(relayed[1]).toEqual(servers[1])
        expect(pool.acquired).toEqual([
            { agentId: 'relay-agent', name: 'discord', cwd: workspaceDir('relay-agent') },
            { agentId: 'relay-agent', name: 'down', cwd: workspaceDir('relay-agent') },
        ])
    })
})
