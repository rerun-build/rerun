import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { sse } from '../agents/__fixtures__/anthropic-sse.js'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-anthropic-thinking-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

type SentBody = { model: string; thinking?: { type: string; display?: string } }

const bodies: SentBody[] = []

const answer = (model: string) => sse([{ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }, { type: 'message_stop' }])

// Anthropic's own rule, in the words it answers with (RER-272).
const anthropicApi = createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => (raw += chunk))
    request.on('end', () => {
        const body = JSON.parse(raw) as SentBody
        bodies.push(body)
        if (body.thinking?.type === 'adaptive' && /-4-5/.test(body.model)) {
            response.writeHead(400, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'adaptive thinking is not supported on this model' } }))
            return
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(answer(body.model))
    })
})
await new Promise<void>(done => anthropicApi.listen(0, '127.0.0.1', done))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropicApi.address() as AddressInfo).port}/v1`

const { afterAll, beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { createConnection } = await import('../connections/store.js')
const { writeBoxDefault } = await import('../connections/default.js')
const { runAgent } = await import('./loop.js')

const id = 'thinkingagent'

// The coworker of the report pins no model: it follows the default of the box.
async function runOnBoxDefault(model: string) {
    const connection = await createConnection({ name: model, provider: 'anthropic', models: [model], extraModels: [], keys: { ANTHROPIC_API_KEY: 'sk-ant-test' } })
    await writeBoxDefault({ connectionId: connection.id, model })
    const session = await createSession(id, 'hello')
    const started = await runAgent(await getAgent(id), session.id, 'hello')
    return started.settled
}

describe('the thinking a run asks of an Anthropic key', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'thinking', selfImprovement: { enabled: false } }))
    })

    beforeEach(() => {
        bodies.length = 0
    })

    afterAll(() => {
        anthropicApi.close()
        delete process.env.ANTHROPIC_BASE_URL
    })

    it.each(['claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5'])('%s answers, asked for no thinking', async model => {
        expect(await runOnBoxDefault(model)).toEqual({ kind: 'done' })
        expect(bodies.map(body => body.thinking)).toEqual([undefined])
    })

    it.each(['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-5-5', 'claude-sonnet-5-5'])('%s is still asked for adaptive thinking', async model => {
        expect(await runOnBoxDefault(model)).toEqual({ kind: 'done' })
        expect(bodies.map(body => body.thinking)).toEqual([{ type: 'adaptive', display: 'summarized' }])
    })
})
