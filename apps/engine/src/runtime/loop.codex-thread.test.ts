import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-codex-thread-'))

const { calls, turn } = vi.hoisted(() => ({
    calls: [] as Array<Record<string, unknown> | undefined>,
    turn: { threadId: 'thread-1', fail: false, closeHangs: false },
}))

vi.mock('./notify.js', async importOriginal => ({ ...(await importOriginal<typeof import('./notify.js')>()), sendNotification: async () => ({ delivered: true }) }))
vi.mock('../tools/registry.js', () => ({ buildTools: async () => ({ tools: {}, close: async () => {} }) }))
vi.mock('../connections/cli-auth.js', () => ({ ensureCliAuth: async () => () => {} }))
vi.mock('../connections/codex-auth.js', () => ({ syncCodexAuth: async () => {} }))
vi.mock('../connections/codex-plan-limits.js', () => ({ refreshCodexPlanLimits: async () => {} }))
// The real curator spawns the Codex CLI after each turn and logs once the file is torn down.
vi.mock('./curator.js', () => ({ runCurator: async () => {} }))
vi.mock('../agents/availability.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../agents/availability.js')>()),
    resolveRunModel: async () => ({ provider: 'codex', model: 'gpt-5.5', connection: { id: 'codex-cnx', provider: 'codex', env: {}, config: {} } }),
}))

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: () => ({
            model: new MockLanguageModelV3({
                doStream: async (options: { providerOptions?: Record<string, Record<string, unknown>> }) => {
                    calls.push(options.providerOptions?.['codex-app-server'])
                    if (turn.fail) throw new Error('codex crashed')
                    return {
                        stream: new ReadableStream({
                            start(controller) {
                                controller.enqueue({ type: 'stream-start', warnings: [] })
                                controller.enqueue({ type: 'text-start', id: '0' })
                                controller.enqueue({ type: 'text-delta', id: '0', delta: 'ok' })
                                controller.enqueue({ type: 'text-end', id: '0' })
                                controller.enqueue({
                                    type: 'finish',
                                    finishReason: { unified: 'stop', raw: 'completed' },
                                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                                    providerMetadata: { 'codex-app-server': { threadId: turn.threadId } },
                                })
                                controller.close()
                            },
                        }),
                    }
                },
            }),
            close: () => (turn.closeHangs ? new Promise<void>(() => {}) : Promise.resolve()),
        }),
    }
})

const { afterEach, beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { appendMessage } = await import('../db/repos/messages.js')
const { forgetCodexThreadsOf } = await import('../agents/codex-threads.js')
const { runAgent } = await import('./loop.js')

const id = 'codexthreadagent'

async function send(sessionId: string, message: string) {
    const run = await runAgent(await getAgent(id), sessionId, message)
    return run.settled
}

describe('a Codex conversation keeps its thread', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'codex thread' }))
    })

    beforeEach(() => {
        calls.length = 0
        turn.threadId = 'thread-1'
        turn.fail = false
        turn.closeHangs = false
        forgetCodexThreadsOf('codex-cnx')
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('starts a thread on the first message and resumes it on the next', async () => {
        const session = await createSession(id, 'hello')
        await send(session.id, 'hello')
        await send(session.id, 'and then?')
        expect(calls).toEqual([undefined, { threadId: 'thread-1' }])
    })

    it('starts a new thread once a message the thread never saw lands in the session', async () => {
        const session = await createSession(id, 'hello')
        await send(session.id, 'hello')
        await appendMessage(id, session.id, { role: 'assistant', content: 'an answer from another provider' })
        await send(session.id, 'and then?')
        expect(calls).toEqual([undefined, undefined])
    })

    it('starts a new thread after a turn that failed', async () => {
        const session = await createSession(id, 'hello')
        await send(session.id, 'hello')
        turn.fail = true
        await send(session.id, 'this one breaks')
        turn.fail = false
        await send(session.id, 'again')
        expect(calls).toEqual([undefined, { threadId: 'thread-1' }, undefined])
    })

    it('keeps each session on its own thread', async () => {
        const first = await createSession(id, 'one')
        const second = await createSession(id, 'two')
        await send(first.id, 'one')
        turn.threadId = 'thread-2'
        await send(second.id, 'two')
        await send(first.id, 'one again')
        expect(calls).toEqual([undefined, undefined, { threadId: 'thread-1' }])
    })

    // An app-server that did not go down in time still holds the thread's writer lock: resuming it
    // would be refused with "already has an active writer" (RER-128).
    it('starts a new thread after a turn whose teardown timed out', async () => {
        const session = await createSession(id, 'hello')
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        turn.closeHangs = true
        let settled = false
        void send(session.id, 'hello').then(() => (settled = true))
        for (let tick = 0; tick < 300 && !settled; tick++) {
            await new Promise(resolve => setImmediate(resolve))
            await vi.advanceTimersByTimeAsync(100)
        }
        expect(settled).toBe(true)
        vi.useRealTimers()
        turn.closeHangs = false
        await send(session.id, 'and then?')
        expect(calls).toEqual([undefined, undefined])
    })
})
