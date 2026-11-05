import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-loop-paths-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

const { sent, stream, prep, curator, recalls } = vi.hoisted(() => ({
    sent: [] as Array<Record<string, unknown>>,
    // `turns` plays one entry per step and `parts` is what every step past the queue gets; `calls`
    // keeps what each step asked of the model.
    stream: { parts: [] as unknown[], turns: [] as unknown[][], calls: [] as Array<Record<string, unknown>>, beforeStream: null as (() => void) | null },
    prep: { toolsError: null as Error | null, modelError: null as Error | null, toolsGate: null as Promise<void> | null, closeError: null as Error | null, callTargets: [] as string[] },
    curator: { calls: [] as unknown[][] },
    recalls: [] as string[],
}))

vi.mock('../memory/store.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../memory/store.js')>()
    return {
        ...actual,
        recallMemory: async (...args: Parameters<typeof actual.recallMemory>) => {
            recalls.push(args[1])
            return actual.recallMemory(...args)
        },
    }
})

vi.mock('./notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./notify.js')>()),
    sendNotification: async (input: Record<string, unknown>) => {
        sent.push(input)
        return { delivered: true }
    },
}))

vi.mock('./curator.js', () => ({
    runCurator: async (...args: unknown[]) => {
        curator.calls.push(args)
    },
}))

vi.mock('../tools/registry.js', async () => {
    const { tool } = await import('ai')
    const { z } = await import('zod')
    const hitl = () => tool({ description: 'hitl', inputSchema: z.record(z.string(), z.unknown()), execute: async () => ({ status: 'delivered' }) })
    return {
        buildTools: async (ctx: { callTargets?: Array<{ id: string }> }) => {
            prep.callTargets = (ctx.callTargets ?? []).map(a => a.id)
            if (prep.toolsGate) await prep.toolsGate
            if (prep.toolsError) throw prep.toolsError
            return {
                tools: { ask_user: hitl(), request_approval: hitl(), suggest_service: hitl(), request_secret: hitl(), mcp__rerun__ask_user: hitl() },
                close: async () => {},
            }
        },
    }
})

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    const { wrapLanguageModel } = await import('ai')
    const { createQuickRepliesCapture } = await import('../agents/quick-replies-stream.js')
    const { createCardTagGuard } = await import('../agents/card-tag-stream.js')
    return {
        ...actual,
        resolveModel: () => {
            if (prep.modelError) throw prep.modelError
            const replies = createQuickRepliesCapture()
            const model = new MockLanguageModelV3({
                doStream: async options => {
                    stream.calls.push(options as Record<string, unknown>)
                    stream.beforeStream?.()
                    const parts = stream.turns.shift() ?? stream.parts
                    return {
                        stream: new ReadableStream({
                            start(controller) {
                                for (const part of parts) controller.enqueue(part)
                                controller.close()
                            },
                        }),
                    }
                },
            })
            return {
                model: wrapLanguageModel({ model, middleware: [replies.middleware, createCardTagGuard('pathsagent', 'rerun')] }),
                close: async () => {
                    if (prep.closeError) throw prep.closeError
                },
                quickReplies: replies.read,
            }
        },
    }
})

const { afterEach, beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { APICallError } = await import('ai')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { getRun, startRun } = await import('../db/repos/runs.js')
const { listMessages } = await import('../db/repos/messages.js')
const { listRunSteps, listToolCalls } = await import('../db/repos/telemetry.js')
const { runAgent } = await import('./loop.js')
const { abortRun, claimSession, sessionClaim } = await import('./run-control.js')
const { armBudgetLatch, clearBudgetLatch, isBudgetLatched } = await import('./budget-latch.js')
const { insertAgentIndex } = await import('../db/repos/agents.js')
const { createConnection } = await import('../connections/store.js')
const { isCredentialRejected, recordCredentialRejected } = await import('../connections/credential-rejections.js')

const id = 'pathsagent'
const quietId = 'quietagent'
const offId = 'offagent'

const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }

function textTurn(text: string, providerMetadata?: Record<string, unknown>): unknown[] {
    return [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: text },
        { type: 'text-end', id: '0' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage, providerMetadata },
    ]
}

// A card normally comes with the message that explains it; pass an empty `text` for one that went out bare.
function toolTurn(toolName: string, input: Record<string, unknown>, text = 'Here is what I found so far.', toolCallId = 'call-1'): unknown[] {
    return [
        { type: 'stream-start', warnings: [] },
        ...(text
            ? [
                  { type: 'text-start', id: '0' },
                  { type: 'text-delta', id: '0', delta: text },
                  { type: 'text-end', id: '0' },
              ]
            : []),
        { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
    ]
}

async function run(message: string, opts: { agentId?: string; override?: Record<string, unknown>; trigger?: Record<string, unknown> } = {}) {
    const agentId = opts.agentId ?? id
    const session = await createSession(agentId, message)
    const agent = await getAgent(agentId)
    const started = await runAgent(agent, session.id, message, opts.override as never, undefined, undefined, opts.trigger as never)
    const outcome = await started.settled
    // The terminal event and the curator run after `settled` resolves.
    await new Promise(r => setTimeout(r, 10))
    return { started, sessionId: session.id, outcome, agentId }
}

const completions = () => sent.filter(n => ['agent.message.completed', 'agent.schedule.completed', 'agent.trigger.completed'].includes(n.event as string))

describe('run loop paths', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'paths' }))
        await mkdir(agentDir(quietId), { recursive: true })
        await writeAgentConfig(quietId, agentConfigSchema.parse({ name: 'quiet', selfImprovement: { enabled: false } }))
        await mkdir(agentDir(offId), { recursive: true })
        await writeAgentConfig(offId, agentConfigSchema.parse({ name: 'off', selfImprovement: { enabled: false }, tools: { quickReplies: false } }))
    })

    afterEach(() => {
        sent.length = 0
        stream.parts = []
        stream.turns = []
        stream.calls = []
        prep.toolsError = null
        prep.modelError = null
        prep.toolsGate = null
        prep.closeError = null
        curator.calls = []
        recalls.length = 0
        clearBudgetLatch()
    })

    describe('when preparation fails', () => {
        it.each([
            ['building the tools', () => (prep.toolsError = new Error('mcp server refused'))],
            ['resolving the model', () => (prep.modelError = new Error('no credential for provider'))],
        ])('closes the run in error when %s throws', async (_label, arrange) => {
            arrange()
            const session = await createSession(id, 'prep')
            const row = await startRun(id, session.id)
            claimSession(session.id, row.id)

            const error = await runAgent(await getAgent(id), session.id, 'prep', undefined, undefined, row.id).catch(e => e)

            expect(error).toBeInstanceOf(Error)
            const stored = await getRun(id, row.id)
            expect(stored?.status).toBe('error')
            expect(stored?.error).toBe(String(error))
            expect(completions()).toHaveLength(1)
            expect(completions()[0]).toMatchObject({ event: 'agent.message.completed', kind: 'error', runId: row.id, message: `Message failed: ${String(error)}` })
            expect(sessionClaim(session.id)).toBeNull()
            expect(curator.calls).toHaveLength(0)
        })

        it('records a stop during preparation as a cancellation, not a failure', async () => {
            let release!: () => void
            prep.toolsGate = new Promise(r => (release = r))
            prep.toolsError = new Error('torn down')
            const session = await createSession(id, 'stop early')
            const row = await startRun(id, session.id)

            const pending = runAgent(await getAgent(id), session.id, 'stop early', undefined, undefined, row.id).catch(e => e)
            await new Promise(r => setTimeout(r, 20))
            expect(abortRun(row.id)).toBe(true)
            release()

            expect(await pending).toBeInstanceOf(Error)
            expect((await getRun(id, row.id))?.status).toBe('cancelled')
            expect(completions()).toHaveLength(1)
            expect((completions()[0].metadata as Record<string, unknown>).status).toBe('cancelled')
        })
    })

    it('completes a plain turn, keeps both sides of it and announces the answer', async () => {
        stream.parts = textTurn('The invoice is paid.')

        const { started, outcome, sessionId } = await run('is the invoice paid?')

        expect(outcome).toEqual({ kind: 'done' })
        const row = await getRun(id, started.runId)
        expect(row?.status).toBe('done')
        expect(row?.stepCount).toBe(1)
        const stored = await listMessages(id, sessionId)
        expect(stored.map(m => m.role)).toEqual(['user', 'assistant'])
        expect(stored[0].contentJson).toContain('is the invoice paid?')
        expect(stored[1].contentJson).toContain('The invoice is paid.')
        const [completion] = completions()
        expect(completion).toMatchObject({ event: 'agent.message.completed', kind: 'done', message: 'The invoice is paid.', source: null })
        expect(completion.metadata).toMatchObject({ status: 'done', stepCount: 1, costMicros: null })
        expect(sessionClaim(sessionId)).toBeNull()
        expect(await listRunSteps(id, started.runId)).toHaveLength(1)
    })

    // The provider caches the prompt by its prefix: the next turn replays the row, so the row holds
    // the turn as it was sent, the context the engine appended included.
    it('stores the user turn exactly as it was sent, its context part marked', async () => {
        stream.parts = textTurn('Noted.')

        const { sessionId } = await run('remember this')

        const stored = JSON.parse((await listMessages(id, sessionId))[0].contentJson) as Array<{ type: string; text: string; providerOptions?: unknown }>
        expect(stored).toHaveLength(2)
        expect(stored[0]).toEqual({ type: 'text', text: 'remember this' })
        expect(stored[1].providerOptions).toEqual({ rerun: { context: true } })
        expect(stored[1].text).toMatch(/^<now>\n\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z .*\n<\/now>$/)

        const prompt = stream.calls[0].prompt as Array<{ role: string; content: Array<{ type: string; text?: string; providerOptions?: unknown }> }>
        const sent = prompt[prompt.length - 1]
        expect(sent.role).toBe('user')
        expect(sent.content.map(p => ({ type: p.type, text: p.text, providerOptions: p.providerOptions }))).toEqual(stored.map(p => ({ type: p.type, text: p.text, providerOptions: p.providerOptions })))
    })

    // The recall waits on the hub's embedding, so it runs alongside the preparation, not after it.
    it('starts the memory recall before the tools are even built', async () => {
        let release!: () => void
        prep.toolsGate = new Promise(r => (release = r))
        stream.parts = textTurn('ok')

        const pending = run('what did we decide?')
        await new Promise(r => setTimeout(r, 20))
        expect(recalls).toEqual(['what did we decide?'])
        release()

        expect((await pending).outcome).toEqual({ kind: 'done' })
        expect(recalls).toHaveLength(1)
    })

    it('offers every other agent as a call target except delegates', async () => {
        await insertAgentIndex(id, 'paths')
        await insertAgentIndex('peer', 'Peer')
        await insertAgentIndex('helper', 'paths delegate')
        stream.parts = textTurn('ok')

        await run('who can help?')

        expect(prep.callTargets).toEqual(['peer'])
    })

    it('still settles when the model teardown fails', async () => {
        prep.closeError = new Error('cli would not exit')
        stream.parts = textTurn('done anyway')

        const { outcome, sessionId } = await run('close badly')

        expect(outcome.kind).toBe('done')
        expect(sessionClaim(sessionId)).toBeNull()
        expect(completions()).toHaveLength(1)
    })

    it('announces a scheduled run under the schedule event', async () => {
        stream.parts = textTurn('Digest sent.')

        await run('send the digest', { trigger: { source: 'schedule', slug: 'digest', name: 'Morning digest' } })

        expect(completions()[0]).toMatchObject({ event: 'agent.schedule.completed', message: 'Schedule "Morning digest" completed', source: 'schedule' })
    })

    it('stores the OpenRouter cost in micro-dollars', async () => {
        stream.parts = textTurn('cheap', { openrouter: { usage: { cost: 0.0123456 } } })

        const { started } = await run('how much?')

        expect((completions()[0].metadata as Record<string, unknown>).costMicros).toBe(12346)
        expect((await getRun(id, started.runId))?.costMicros).toBe(12346)
    })

    // OpenCode reports what a step was worth to the user: nothing on the Go plan, the list price on
    // Console. Both are real costs, so a Go run stores 0 rather than null.
    it('stores the OpenCode cost, a Go call at zero', async () => {
        stream.parts = textTurn('paid', { opencode: { billingSource: 'balance', cost: 0.00042 } })
        const { started } = await run('console?')
        expect((await getRun(id, started.runId))?.costMicros).toBe(420)

        stream.parts = textTurn('included', { opencode: { billingSource: 'go', cost: 0 } })
        const second = await run('go?')
        expect((await getRun(id, second.started.runId))?.costMicros).toBe(0)
    })

    it('ignores a cost that is not a finite number', async () => {
        stream.parts = textTurn('free', { openrouter: { usage: { cost: 'n/a' } } })

        await run('how much now?')

        expect((completions()[0].metadata as Record<string, unknown>).costMicros).toBeNull()
    })

    describe('a turn that stops on a question for the user', () => {
        it.each([
            ['ask_user', { question: 'Which color?' }, 'question', 'Which color?'],
            ['ask_user', { questions: JSON.stringify([{ question: 'Which size?' }, { question: 'Which color?' }]) }, 'question', 'Which size? (+1 more)'],
            ['ask_user', {}, 'question', 'The coworker has a question'],
            ['ask_user', { questions: 'not json', question: 'Fallback?' }, 'question', 'Fallback?'],
            ['suggest_service', { services: [{ slug: 'stripe' }, { slug: 'notion' }] }, 'connector', 'Set up stripe (+1 more)'],
            ['suggest_service', { services: [{ slug: 'gmail' }] }, 'connector', 'Set up gmail'],
            ['suggest_service', {}, 'connector', 'Set up an app'],
            ['request_secret', { secrets: [{ key: 'API_KEY', label: 'Stripe key' }] }, 'connector', 'Needs Stripe key'],
            ['request_approval', { approvals: [{ action: 'Send the email' }] }, 'approval', 'Send the email'],
            ['mcp__rerun__ask_user', { question: 'Bridged?' }, 'question', 'Bridged?'],
        ])('%s with %j notifies a %s and sends no completion', async (toolName, input, kind, message) => {
            stream.parts = toolTurn(toolName, input)

            const { started, outcome, sessionId } = await run('help me')

            expect(outcome.kind).toBe('done')
            expect(completions()).toHaveLength(0)
            const notification = sent.find(n => n.event === 'agent.notification')
            expect(notification).toMatchObject({ kind, message, runId: started.runId, sessionId })
            expect(notification?.metadata).toMatchObject({ toolCallId: 'call-1', toolName: toolName.replace('mcp__rerun__', '') })
            expect(curator.calls).toHaveLength(0)
            const stored = JSON.stringify(await listMessages(id, sessionId))
            expect(stored).not.toContain('mcp__rerun__')
            const calls = await listToolCalls(id, started.runId)
            expect(calls).toHaveLength(1)
            expect(calls[0]).toMatchObject({ toolName, isError: 0 })
            expect((await getRun(id, started.runId))?.stepCount).toBe(1)
        })
    })

    it('names the member who sent the message on the question it stops on', async () => {
        stream.parts = toolTurn('ask_user', { question: 'Which color?' })

        await run('help me', { trigger: { source: 'chat', author: { id: 'u1', name: 'Marie' } } })

        expect(sent.find(n => n.event === 'agent.notification')?.metadata).toMatchObject({ toolCallId: 'call-1', toolName: 'ask_user', authorId: 'u1' })
    })

    it('leaves the author out of a question raised by a scheduled run', async () => {
        stream.parts = toolTurn('ask_user', { question: 'Which color?' })

        await run('help me', { trigger: { source: 'schedule', slug: 'daily', name: 'Daily' } })

        expect(sent.find(n => n.event === 'agent.notification')?.metadata).not.toHaveProperty('authorId')
    })

    describe('a card that went out without its message', () => {
        it('buys the model one tool-less step to write it, then stops on the card', async () => {
            stream.turns = [toolTurn('ask_user', { question: 'Which color?' }, ''), textTurn('I need the color before I draft anything.')]

            const { started, outcome, sessionId } = await run('help me')

            expect(outcome.kind).toBe('done')
            expect(completions()).toHaveLength(0)
            expect(sent.find(n => n.event === 'agent.notification')).toMatchObject({ kind: 'question', message: 'Which color?', runId: started.runId })
            expect((await getRun(id, started.runId))?.stepCount).toBe(2)
            expect(stream.calls).toHaveLength(2)
            expect(stream.calls[0].toolChoice).not.toEqual({ type: 'none' })
            expect(stream.calls[1].toolChoice).toEqual({ type: 'none' })
            const stored = await listMessages(id, sessionId)
            expect(stored.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
            expect(stored[3].contentJson).toContain('I need the color before I draft anything.')
        })

        it('stops after that step whatever the model does with it', async () => {
            stream.turns = [toolTurn('ask_user', { question: 'Which color?' }, ''), toolTurn('ask_user', { question: 'Which size?' }, '', 'call-2')]

            const { started, outcome } = await run('help me')

            expect(outcome.kind).toBe('done')
            expect((await getRun(id, started.runId))?.stepCount).toBe(2)
            expect(stream.calls).toHaveLength(2)
            expect(sent.find(n => n.event === 'agent.notification')?.metadata).toMatchObject({ toolCallId: 'call-2' })
        })
    })

    // The replies close the message as a block of its text; the engine cuts it out on its way and
    // keeps them beside the row the chat reads them from.
    describe('the quick replies block', () => {
        const BLOCK = '<quick_replies>\nFind 100 more\nExport them as CSV\n</quick_replies>'
        const answerOf = async (sessionId: string, agentId = id) => (await listMessages(agentId, sessionId)).filter(m => m.role === 'assistant').at(-1)

        it('stores the message without the block and the replies beside it', async () => {
            stream.parts = textTurn(`Here are your 100 leads.\n${BLOCK}`)

            const { sessionId, started } = await run('find leads')

            const answer = await answerOf(sessionId)
            expect(answer?.contentJson).toBe(JSON.stringify([{ type: 'text', text: 'Here are your 100 leads.' }]))
            expect(JSON.parse(answer?.toolCallsJson ?? 'null')).toEqual([{ toolCallId: expect.any(String), toolName: 'suggest_replies', input: { replies: ['Find 100 more', 'Export them as CSV'] } }])
            expect(started.quickReplies?.()?.replies).toEqual(['Find 100 more', 'Export them as CSV'])
            expect(completions()[0]).toMatchObject({ message: 'Here are your 100 leads.' })
        })

        it('keeps the replies off a turn that ends on a card, and off a coworker with the switch off', async () => {
            stream.parts = toolTurn('ask_user', { question: 'Which one?' }, `Two options.\n${BLOCK}`)
            const card = await run('find leads')
            expect((await answerOf(card.sessionId))?.toolCallsJson).toBeNull()
            expect((await answerOf(card.sessionId))?.contentJson).not.toContain('quick_replies')

            stream.parts = textTurn(`Done.\n${BLOCK}`)
            const off = await run('find leads', { agentId: offId })
            expect(off.outcome).toEqual({ kind: 'done' })
            expect((await answerOf(off.sessionId, offId))?.toolCallsJson).toBeNull()
            expect((await answerOf(off.sessionId, offId))?.contentJson).toBe(JSON.stringify([{ type: 'text', text: 'Done.' }]))
            expect(off.started.quickReplies).toBeUndefined()
        })
    })

    // A model that learned the replies block writes a card the same way, as a tag in its text with
    // no call behind it: the tag goes before the chat, the row and the history see it.
    describe('a card written as a tag', () => {
        it('stores the message without the tag, waits on nobody, and completes', async () => {
            stream.parts = textTurn('Which angle do you want?\n\n<ask_user>\n</ask_user>')

            const { sessionId, outcome } = await run('write an article')

            expect(outcome).toEqual({ kind: 'done' })
            const answer = (await listMessages(id, sessionId)).filter(m => m.role === 'assistant').at(-1)
            expect(answer?.contentJson).toBe(JSON.stringify([{ type: 'text', text: 'Which angle do you want?' }]))
            expect(sent.find(n => n.event === 'agent.notification')).toBeUndefined()
            expect(completions()[0]).toMatchObject({ message: 'Which angle do you want?' })
        })
    })

    describe('the managed-model budget latch', () => {
        it('arms on a budget error from the rerun provider', async () => {
            stream.parts = [
                { type: 'stream-start', warnings: [] },
                { type: 'error', error: new Error('rerun_budget_exhausted: top up to continue') },
            ]

            const { outcome } = await run('spend', { override: { provider: 'rerun' } })

            expect(outcome.errorCode).toBe('rerun_budget_exhausted')
            expect(isBudgetLatched()).toBe(true)
        })

        it('clears on a successful rerun turn', async () => {
            armBudgetLatch()
            stream.parts = textTurn('back in business')

            await run('try again', { override: { provider: 'rerun' } })

            expect(isBudgetLatched()).toBe(false)
        })

        it('is left alone by a turn on another provider', async () => {
            armBudgetLatch()
            stream.parts = textTurn('own key')

            await run('elsewhere', { override: { provider: 'openai' } })

            expect(isBudgetLatched()).toBe(true)
        })
    })

    it('keeps the reason a provider gave for turning the request down', async () => {
        const reason = 'tools.0.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level'
        const refusal = new APICallError({
            message: 'Provider returned error',
            url: 'https://hub.test/api/llm/chat/completions',
            requestBodyValues: {},
            statusCode: 400,
            responseBody: JSON.stringify({ error: { message: 'Provider returned error', metadata: { raw: JSON.stringify({ message: reason }) } } }),
        })
        stream.parts = [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: refusal },
        ]

        const { outcome } = await run('refused', { override: { provider: 'rerun' } })

        expect(outcome.errorCode).toBe('provider_refused')
        expect(outcome.error).toBe(`ProviderRefusedError: Provider returned error: ${reason}`)
    })

    describe('a credential the provider turns away', () => {
        const unauthorized = () => [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: new Error('401 Unauthorized: invalid x-api-key') },
        ]
        const anthropicKey = () => createConnection({ name: 'Anthropic', provider: 'anthropic', models: ['claude-sonnet-5'], extraModels: [], keys: { ANTHROPIC_API_KEY: 'sk-ant-api-revoked' } })

        it('flags the connection the run billed', async () => {
            const cnx = await anthropicKey()
            stream.parts = unauthorized()

            const { outcome } = await run('revoked', { override: { connectionId: cnx.id } })

            expect(outcome.errorCode).toBe('provider_unauthorized')
            expect(isCredentialRejected(cnx.id)).toBe(true)
        })

        it('is cleared by a turn that goes through on it', async () => {
            const cnx = await anthropicKey()
            recordCredentialRejected(cnx.id)
            stream.parts = textTurn('signed in again')

            await run('works again', { override: { connectionId: cnx.id } })

            expect(isCredentialRejected(cnx.id)).toBe(false)
        })

        describe('on a Claude sign-in', () => {
            const revoked = () => [
                { type: 'stream-start', warnings: [] },
                { type: 'error', error: new Error('AI_LoadAPIKeyError: Failed to authenticate. API Error: 401 OAuth access token has been revoked.') },
            ]
            const claudeSignIn = () =>
                createConnection({
                    name: 'Claude',
                    provider: 'claude',
                    models: ['claude-opus-5-5'],
                    extraModels: [],
                    keys: { CLAUDE_CODE_OAUTH_TOKEN: 'spawn-token', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh-token', CLAUDE_CODE_OAUTH_EXPIRES_AT: String(Date.now() + 8 * 3_600_000) },
                })

            it('reads a 401 on a token renewed mid-run as an interruption, not a signed-out connection', async () => {
                const cnx = await claudeSignIn()
                stream.parts = revoked()
                stream.beforeStream = () => {
                    cnx.env.CLAUDE_CODE_OAUTH_TOKEN = 'renewed-token'
                }

                const { outcome } = await run('renewed under the run', { override: { connectionId: cnx.id } })
                stream.beforeStream = null

                expect(outcome.errorCode).toBe('provider_auth_renewed')
                expect(outcome.error).toContain('interrupted: Claude sign-in renewed during the run')
                expect(isCredentialRejected(cnx.id)).toBe(false)
            })

            it('still flags the connection when the token it ran on is the current one', async () => {
                const cnx = await claudeSignIn()
                stream.parts = revoked()

                const { outcome } = await run('revoked for real', { override: { connectionId: cnx.id } })

                expect(outcome.errorCode).toBe('provider_unauthorized')
                expect(isCredentialRejected(cnx.id)).toBe(true)
            })

            it('keeps a lapsed token whose refresh token Anthropic refused as a signed-out connection', async () => {
                const cnx = await createConnection({
                    name: 'Claude',
                    provider: 'claude',
                    models: ['claude-opus-5-5'],
                    extraModels: [],
                    keys: { CLAUDE_CODE_OAUTH_TOKEN: 'spawn-token', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'dead-refresh-token', CLAUDE_CODE_OAUTH_EXPIRES_AT: String(Date.now() - 1) },
                })
                const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
                stream.parts = revoked()

                try {
                    const { outcome } = await run('lapsed and dead', { override: { connectionId: cnx.id } })
                    expect(fetchSpy).toHaveBeenCalled()
                    expect(outcome.errorCode).toBe('provider_unauthorized')
                    expect(isCredentialRejected(cnx.id)).toBe(true)
                } finally {
                    fetchSpy.mockRestore()
                }
            })
        })

        it('leaves the keyless Rerun connection alone, its key is the hub one', async () => {
            stream.parts = unauthorized()

            await run('hub key', { override: { provider: 'rerun' } })

            expect(isCredentialRejected('rerun')).toBe(false)
        })
    })

    describe('the curator', () => {
        it('reviews a finished turn with what was asked and answered', async () => {
            stream.parts = textTurn('Noted, you prefer mornings.')

            const { sessionId } = await run('I prefer mornings')

            expect(curator.calls).toHaveLength(1)
            const [agent, calledSession, userText, assistantText] = curator.calls[0] as [{ id: string }, string, string, string]
            expect(agent.id).toBe(id)
            expect(calledSession).toBe(sessionId)
            expect(userText).toBe('I prefer mornings')
            expect(assistantText).toBe('Noted, you prefer mornings.')
        })

        it('stays out of a failed turn', async () => {
            stream.parts = [
                { type: 'stream-start', warnings: [] },
                { type: 'error', error: new Error('boom') },
            ]

            await run('fail')

            expect(curator.calls).toHaveLength(0)
        })

        it('stays out when the agent has self-improvement off', async () => {
            stream.parts = textTurn('ok')

            await run('remember this', { agentId: quietId })

            expect(curator.calls).toHaveLength(0)
        })

        it('stays out of a turn with no user text', async () => {
            stream.parts = textTurn('ok')

            await run('')

            expect(curator.calls).toHaveLength(0)
        })
    })
})
