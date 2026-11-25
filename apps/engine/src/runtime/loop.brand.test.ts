import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'loop-brand-'))
process.env.RERUN_API_KEY = 'box-key'
process.env.RERUN_HUB_BASE_URL = 'https://hub.example.com'
process.env.RERUN_LOG_LEVEL = 'fatal'

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('./notify.js', async importOriginal => ({ ...(await importOriginal<typeof import('./notify.js')>()), sendNotification: async () => ({ delivered: true }) }))
vi.mock('./curator.js', () => ({ runCurator: async () => {} }))
vi.mock('../agents/providers.js', async importOriginal => {
    const { MockLanguageModelV3 } = await import('ai/test')
    const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }
    const parts = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: 'ok' },
        { type: 'text-end', id: '0' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]
    const model = new MockLanguageModelV3({
        doStream: async options => {
            calls.push(JSON.stringify(options.prompt))
            return { stream: new ReadableStream({ start: controller => (parts.forEach(part => controller.enqueue(part as never)), controller.close()) }) }
        },
    })
    return { ...(await importOriginal<typeof import('../agents/providers.js')>()), resolveModel: () => ({ model, close: async () => {} }) }
})

const { afterEach, beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { createSession } = await import('../db/repos/sessions.js')
const { runAgent } = await import('./loop.js')

const name = { value: 'Nordlys' }
const now = { value: Date.parse('2026-11-24T10:00:00Z') }

async function promptOf(agentId: string, trigger: Record<string, unknown>): Promise<string> {
    calls.length = 0
    const session = await createSession(agentId, 'hi')
    const started = await runAgent(await getAgent(agentId), session.id, 'hi', undefined, undefined, undefined, trigger as never)
    await started.settled
    return calls[0]
}

describe('every way a run starts', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir('branded'), { recursive: true })
        await writeAgentConfig('branded', agentConfigSchema.parse({ name: 'branded', selfImprovement: { enabled: false } }))
        await ensureForeman()
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
            const path = new URL(String(input)).pathname
            return path === '/api/engines/brand' ? Response.json({ name: name.value, whiteLabel: true, supportEmail: null }) : new Response('down', { status: 503 })
        })
        vi.spyOn(Date, 'now').mockImplementation(() => now.value)
    })

    // Each case renames the brand first, so a prompt only carries the name its own run asked for.
    afterEach(() => {
        now.value += 61_000
    })

    it.each([
        ['a chat', 'branded', { source: 'chat' }],
        ['a call from another coworker', 'branded', { source: 'chat', calledBy: { id: 'a', name: 'A', waiting: true } }],
        ['a routine', 'branded', { source: 'schedule', slug: 's', name: 's' }],
        ['a webhook', 'branded', { source: 'trigger', slug: 's', name: 's' }],
        ['the end of a job', 'branded', { source: 'job', computer: 'pc', jobId: 'j' }],
        ['a check-in', 'foreman', { source: 'checkin', slug: 'c', name: 'c', reason: 'pulse' }],
        ['the Chief of Staff without a brief', 'foreman', { source: 'chat' }],
    ])('%s carries the brand of the workspace', async (_label, agentId, trigger) => {
        name.value = `Brand${Math.random().toString(36).slice(2, 8)}`
        expect(await promptOf(agentId, trigger)).toContain(`The product you are part of is called ${name.value}`)
    })
})
