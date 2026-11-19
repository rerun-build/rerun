import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-chat-stream-'))
process.env.RERUN_API_KEY = ''

// The chunks of a chat as the hub pipes them to the app, from a run that uses every kind of part a
// coworker streams. The app's AI SDK reads them with its own schema (apps/mobile/src/chat), and one it
// does not know fails the whole answer: the file below is what both sides are held to.
const FIXTURE = resolve(import.meta.dirname, '../../../mobile/api-contract/chat-stream.json')

const turns = vi.hoisted(() => ({ calls: 0 }))

vi.mock('../tools/registry.js', async () => {
    const { tool } = await import('ai')
    const { z } = await import('zod')
    return {
        buildTools: async (ctx: { writer?: { write: (part: unknown) => void } }) => ({
            tools: {
                find_leads: tool({
                    description: 'Find leads in a city',
                    inputSchema: z.object({ city: z.string() }),
                    execute: async ({ city }, { toolCallId }) => {
                        ctx.writer?.write({ type: 'data-delegate', id: toolCallId, data: { tasks: [{ id: 'task-1', title: `Leads in ${city}`, status: 'done' }] } })
                        return { leads: [{ name: 'Maison Nord', city }] }
                    },
                }),
                send_email: tool({
                    description: 'Send an email',
                    inputSchema: z.object({ to: z.string() }),
                    execute: async () => {
                        throw new Error('The mailbox refused the address')
                    },
                }),
            },
            close: async () => {},
        }),
    }
})

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    const usage = { inputTokens: 120, outputTokens: 40, totalTokens: 160 }
    const first = [
        { type: 'stream-start', warnings: [] },
        { type: 'response-metadata', id: 'resp-1', modelId: 'mock-model', timestamp: new Date('2026-11-19T09:00:00.000Z') },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'Lyon first, then the email.' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Looking for leads in Lyon.' },
        { type: 'text-end', id: 't1' },
        { type: 'tool-call', toolCallId: 'call-leads', toolName: 'find_leads', input: JSON.stringify({ city: 'Lyon' }) },
        { type: 'tool-call', toolCallId: 'call-email', toolName: 'send_email', input: JSON.stringify({ to: 'hello@maison-nord.fr' }) },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
    ]
    const second = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't2' },
        { type: 'text-delta', id: 't2', delta: 'Found Maison Nord. The email did not go out.' },
        { type: 'text-end', id: 't2' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
    ]
    return {
        ...actual,
        resolveModel: () => ({
            model: new MockLanguageModelV3({
                doStream: async () => {
                    const parts = turns.calls++ === 0 ? first : second
                    return { stream: new ReadableStream({ start: controller => (parts.forEach(part => controller.enqueue(part)), controller.close()) }) }
                },
            }),
            close: async () => {},
        }),
    }
})

const { beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { parseJsonEventStream, uiMessageChunkSchema } = await import('ai')
const { migrate } = await import('../db/migrate.js')
const { createServer } = await import('../http/server.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')

const ID = 'streamagent'

// What changes from one run to the next, set to one value so the file only changes with the shape.
function normalized(chunk: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...chunk }
    if (typeof out.messageId === 'string') out.messageId = 'message-1'
    return out
}

async function streamedChunks(): Promise<Record<string, unknown>[]> {
    turns.calls = 0
    const res = await createServer().request(`/agents/${ID}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Find leads in Lyon and email the first one' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)
    const chunks: Record<string, unknown>[] = []
    const reader = parseJsonEventStream({ stream: res.body!, schema: uiMessageChunkSchema }).getReader()
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
        if (!next.value.success) throw new Error(`A chunk the AI SDK cannot read: ${JSON.stringify(next.value.rawValue)}`)
        chunks.push(normalized(next.value.value as Record<string, unknown>))
    }
    return chunks
}

describe('the stream of a chat', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(ID), { recursive: true })
        await writeAgentConfig(ID, agentConfigSchema.parse({ name: 'stream' }))
    })

    it('streams reasoning, text, a tool that answers, a tool that fails and a data part', async () => {
        const types = new Set((await streamedChunks()).map(chunk => chunk.type))
        for (const type of ['start', 'start-step', 'reasoning-delta', 'text-delta', 'tool-input-available', 'tool-output-available', 'tool-output-error', 'data-delegate', 'finish-step', 'finish']) expect(types).toContain(type)
    }, 30_000)

    // A change to what the engine streams shows in the diff of its pull request, and the app's test
    // (apps/mobile/src/chat/chat-stream.test.ts) reads the new file with the app's own AI SDK.
    it('is the stream the app is tested against', async () => {
        const chunks = await streamedChunks()
        if (process.env.UPDATE_CHAT_STREAM === '1') writeFileSync(FIXTURE, `${JSON.stringify({ chunks }, null, 4)}\n`)
        expect(chunks).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')).chunks)
    }, 30_000)
})
