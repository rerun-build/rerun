import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-screen-stretches-'))

type Budget = { perStretch: number; take: () => unknown; saw: (view: Buffer) => void }
type Session = { say: string; note?: string; fails?: string; queue?: unknown[] }

const { sent, sessions, state } = vi.hoisted(() => ({
    sent: [] as Array<Record<string, unknown>>,
    sessions: [] as Session[],
    state: { prompts: [] as string[], opened: 0, closed: [] as string[], toolsClosed: 0, leases: 0, provider: 'claude', closing: undefined as (() => Promise<void>) | undefined, budget: undefined as Budget | undefined, duringAuth: undefined as (() => void) | undefined, runId: '' },
}))

vi.mock('./notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./notify.js')>()),
    sendNotification: async (input: Record<string, unknown>) => {
        sent.push(input)
        return { delivered: true }
    },
}))
vi.mock('../tools/registry.js', () => ({
    buildTools: async (ctx: { screenBudget: Budget }) => {
        state.budget = ctx.screenBudget
        return {
            tools: {},
            close: async () => {
                state.toolsClosed++
            },
        }
    },
}))
vi.mock('../connections/cli-auth.js', () => ({
    ensureCliAuth: async () => {
        state.leases++
        if (state.opened > 0) state.duringAuth?.()
        return () => {
            state.leases--
        }
    },
}))
vi.mock('../connections/codex-auth.js', () => ({ syncCodexAuth: async () => {} }))
vi.mock('../connections/codex-plan-limits.js', () => ({ refreshCodexPlanLimits: async () => {} }))
vi.mock('./curator.js', () => ({ runCurator: async () => {} }))
vi.mock('../agents/availability.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../agents/availability.js')>()),
    resolveRunModel: async () => ({ provider: state.provider, model: 'model-1', connection: { id: 'cnx', provider: state.provider, env: {}, config: {} } }),
}))

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    const said = (id: string, delta: string) => [{ type: 'text-start', id }, { type: 'text-delta', id, delta }, { type: 'text-end', id }]
    const spend = (index: number): void => {
        for (let i = 0; i < state.budget!.perStretch; i++) {
            state.budget!.take()
            state.budget!.saw(Buffer.alloc(57_600).fill(255, (index * 60 + i) * 90, (index * 60 + i) * 90 + 200))
        }
        state.budget!.take()
    }
    const usage = { inputTokens: { total: 100, noCache: 20, cacheRead: 80, cacheWrite: 0 }, outputTokens: { total: 10, text: 10 } }
    return {
        ...actual,
        resolveModel: () => {
            const index = state.opened++
            return {
                model: new MockLanguageModelV3({
                    doStream: async ({ prompt }) => {
                        const session = sessions[index]
                        state.prompts.push(JSON.stringify(prompt))
                        if (session.fails) throw new Error(session.fails)
                        return {
                            stream: new ReadableStream(
                                {
                                    pull(controller) {
                                        const queue = (session.queue ??= [
                                            { type: 'stream-start', warnings: [] },
                                            ...said('0', session.say),
                                            ...(session.note ? [() => spend(index), ...said('1', session.note)] : []),
                                            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage, providerMetadata: { 'codex-app-server': { threadId: `thread-${index}` } } },
                                        ])
                                        let next = queue.shift()
                                        if (typeof next === 'function') {
                                            next()
                                            next = queue.shift()
                                        }
                                        if (next) controller.enqueue(next as never)
                                        else controller.close()
                                    },
                                },
                                { highWaterMark: 0 },
                            ),
                        }
                    },
                }),
                close: async () => {
                    state.closed.push(`session ${index}`)
                    if (index === 0) await state.closing?.()
                },
                quickReplies: () => undefined,
            }
        },
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
const { getRun, startRun } = await import('../db/repos/runs.js')
const { lastMessageId, listMessages } = await import('../db/repos/messages.js')
const { codexThreadToResume } = await import('../agents/codex-threads.js')
const { abortRun } = await import('./run-control.js')
const { runAgent } = await import('./loop.js')
const { mergeRunStream } = await import('./run-stream-merge.js')

const id = 'stretchagent'

async function send(message = 'Fill the page') {
    const session = await createSession(id, message)
    const { id: runId } = await startRun(id, session.id)
    state.runId = runId
    const run = await runAgent(await getAgent(id), session.id, message, undefined, undefined, runId)
    const chunks: Array<{ type: string; delta?: string }> = []
    let read: Promise<void> = Promise.resolve()
    mergeRunStream(
        {
            merge: (stream: ReadableStream) => {
                read = (async () => {
                    for await (const chunk of stream as unknown as AsyncIterable<(typeof chunks)[number]>) chunks.push(chunk)
                })()
            },
        } as never,
        run,
    )
    const outcome = await run.settled
    await read
    return { outcome, chunks, sessionId: session.id, run: (await getRun(id, runId))!, rows: await listMessages(id, session.id) }
}

const said = (rows: Awaited<ReturnType<typeof send>>['rows']) => rows.filter(row => row.role === 'assistant').map(row => (JSON.parse(row.contentJson) as Array<{ text?: string }>).map(part => part.text).join('|'))

describe('a run on a subscription that uses up the screenshots of a stretch', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'stretch', selfImprovement: { enabled: false } }))
    })

    beforeEach(() => {
        sent.length = 0
        sessions.length = 0
        Object.assign(state, { prompts: [], opened: 0, closed: [], toolsClosed: 0, leases: 0, provider: 'claude', closing: undefined, duringAuth: undefined })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it.each(['claude', 'codex'])('goes on to the end by itself on %s: one run, one answer, one notification', async provider => {
        state.provider = provider
        sessions.push({ say: 'Filling.', note: 'NOTE: I hit a limit at 8 of 12.' }, { say: 'Going on.', note: 'NOTE: 11 of 12 done.' }, { say: 'All done.' })
        const { outcome, run, rows, chunks, sessionId } = await send()

        expect(outcome).toEqual({ kind: 'done' })
        expect(run.status).toBe('done')
        expect([run.inputTokens, run.cachedInputTokens, run.outputTokens]).toEqual([300, 240, 30])
        expect(said(rows)).toEqual(['Filling.|Going on.|All done.'])
        expect(chunks.flatMap(chunk => chunk.delta ?? []).join('|')).toBe('Filling.|Going on.|All done.')
        expect(JSON.stringify(sent)).not.toContain('NOTE')
        expect(sent).toHaveLength(1)
        expect(chunks.filter(chunk => chunk.type === 'finish')).toHaveLength(1)
        expect(chunks.filter(chunk => chunk.type === 'start')).toHaveLength(1)
        expect(state.prompts[2]).toMatch(/Fill the page.*8 of 12.*11 of 12.*take a screenshot first/)
        expect(state.closed).toEqual(['session 0', 'session 1', 'session 2'])
        expect(state.toolsClosed).toBe(1)
        expect(state.leases).toBe(0)
        if (provider === 'codex') expect(codexThreadToResume(id, sessionId, 'cnx', await lastMessageId(id, sessionId))).toBe('thread-2')
    })

    it('fails like any run when the next session cannot start, keeping what was done', async () => {
        sessions.push({ say: 'Filling.', note: 'NOTE: 8 of 12 done.' }, { say: '', fails: 'codex crashed' })
        const { outcome, rows } = await send()
        expect(outcome).toMatchObject({ kind: 'error', error: expect.stringContaining('codex crashed') })
        expect(said(rows)).toEqual(['Filling.|NOTE: 8 of 12 done.'])
        expect(state.toolsClosed).toBe(1)
        expect(state.leases).toBe(0)
    })

    it.each([
        ['never closes', () => new Promise<void>(() => {})],
        ['fails to close', () => Promise.reject(new Error('kill EACCES'))],
    ])('goes on when the session of the last stretch %s', async (_name, closing) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        state.provider = 'codex'
        state.closing = closing
        sessions.push({ say: 'Filling.', note: 'NOTE: 8 of 12 done.' }, { say: 'All done.' })
        let answered: Awaited<ReturnType<typeof send>> | undefined
        void send().then(answer => (answered = answer))
        for (let tick = 0; tick < 400 && !answered; tick++) {
            await new Promise(resolve => setImmediate(resolve))
            await vi.advanceTimersByTimeAsync(100)
        }
        vi.useRealTimers()
        expect(answered?.outcome).toEqual({ kind: 'done' })
        expect(said(answered!.rows)).toEqual(['Filling.|All done.'])
        expect(state.opened).toBe(2)
        await vi.waitFor(() => expect(state.leases).toBe(0))
    })

    it('opens no session once Stop was pressed in between, and gives everything back', async () => {
        state.duringAuth = () => void abortRun(state.runId)
        sessions.push({ say: 'Filling.', note: 'NOTE: 8 of 12 done.' }, { say: 'never' })
        const { outcome, rows } = await send()
        expect(outcome).toEqual({ kind: 'cancelled' })
        expect(state.opened).toBe(1)
        expect(said(rows)[0]).toContain('Filling.')
        expect(state.toolsClosed).toBe(1)
        await vi.waitFor(() => expect(state.leases).toBe(0))
    })
})
