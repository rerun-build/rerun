import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-settle-'))

// Captured instead of sent: the assertions are about what the hub is told, which is the only thing
// that moves a conversation off "working".
const { sent, stream, partial, proposal, prompts, storage, ending } = vi.hoisted(() => ({
    prompts: [] as string[],
    storage: { delayMs: 0 },
    ending: { fails: false },
    sent: [] as Array<Record<string, unknown>>,
    stream: { parts: [] as unknown[], hang: false },
    partial: { push: false },
    proposal: { push: false },
}))

vi.mock('./notify.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./notify.js')>()
    return {
        ...actual,
        sendNotification: async (input: Record<string, unknown>) => {
            sent.push(input)
            return { delivered: true }
        },
    }
})

vi.mock('../db/repos/messages.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../db/repos/messages.js')>()
    return {
        ...actual,
        appendMessage: async (...args: Parameters<typeof actual.appendMessage>) => {
            if (storage.delayMs && args[2].role !== 'user') await new Promise(resolve => setTimeout(resolve, storage.delayMs))
            return actual.appendMessage(...args)
        },
    }
})

vi.mock('../tools/registry.js', () => ({
    buildTools: async (ctx: { partialResults?: { label: string; text: string }[]; skillProposals?: { proposalId: string; mode: string; title: string }[] }) => {
        if (partial.push) ctx.partialResults?.push({ label: 'Task 1 — competitors', text: 'four brands found' })
        if (proposal.push) ctx.skillProposals?.push({ proposalId: 'proposal-1', mode: 'create', title: 'Publishing checklist' })
        return { tools: {}, close: async () => {} }
    },
}))

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: () => ({
            model: new MockLanguageModelV3({
                doStream: async (options: { prompt: unknown }) => {
                    prompts.push(JSON.stringify(options.prompt))
                    return {
                        stream: new ReadableStream({
                            start(controller) {
                                for (const part of stream.parts) controller.enqueue(part)
                                // A provider that wedges never closes its stream: no finish part, no
                                // error part, no callback of any kind.
                                if (!stream.hang) controller.close()
                            },
                        }),
                    }
                },
            }),
            close: async () => {},
            contextUsage: () => {
                if (ending.fails) throw new Error('context usage unreadable')
                return undefined
            },
        }),
    }
})

const { afterEach, beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { getRun } = await import('../db/repos/runs.js')
const { listMessages } = await import('../db/repos/messages.js')
const { findPendingHitl } = await import('../tools/builtin/hitl.js')
const { stoppedCallResult, stoppedTurnNote } = await import('./stopped-turn.js')
const { STREAM_CUT_RAW_REASON } = await import('./provider-errors.js')
const { runAgent } = await import('./loop.js')
const { abortRun, claimSession, sessionClaim } = await import('./run-control.js')

const id = 'settleagent'

const textTurn = (finishReason: { unified: string; raw?: string }): unknown[] => [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '0' },
    { type: 'text-delta', id: '0', delta: 'partial answer' },
    { type: 'text-end', id: '0' },
    { type: 'finish', finishReason, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
]

async function runToSettlement(message: string, author?: { id: string; name: string }) {
    const session = await createSession(id, message)
    const agent = await getAgent(id)
    const run = await runAgent(agent, session.id, message, undefined, undefined, undefined, { source: 'chat', author })
    return { run, sessionId: session.id, outcome: await run.settled }
}

describe('a run always reaches a terminal state', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'settle' }))
    })

    afterEach(() => {
        sent.length = 0
        stream.parts = []
        stream.hang = false
        partial.push = false
        proposal.push = false
        prompts.length = 0
        storage.delayMs = 0
        ending.fails = false
    })

    // A spent Codex subscription arrives as a plain finish, not as an error. Taken at face value it
    // stores an empty turn as a success and the reason the agent said nothing is lost.
    it('fails a turn the provider finished on a usage limit', async () => {
        stream.parts = textTurn({ unified: 'length', raw: 'usage_limit_exceeded' })

        const { outcome, run } = await runToSettlement('spend the quota')

        expect(outcome.kind).toBe('error')
        expect(outcome.errorCode).toBe('provider_usage_limit')
        const row = await getRun(id, run.runId)
        expect(row?.status).toBe('error')
        expect(row?.finishedAt).not.toBeNull()
        const completion = sent.find(n => n.event === 'agent.message.completed')
        expect(completion?.kind).toBe('error')
        expect((completion?.metadata as Record<string, unknown>).errorCode).toBe('provider_usage_limit')
    })

    it('keeps a plain max_tokens truncation a success', async () => {
        stream.parts = textTurn({ unified: 'length', raw: 'max_tokens' })

        const { outcome, run } = await runToSettlement('write a long answer')

        expect(outcome.kind).toBe('done')
        expect((await getRun(id, run.runId))?.status).toBe('done')
    })

    // An error part makes the SDK call onError *and then* onFinish. Both used to write the run, so
    // the `done` arriving second overwrote the failure: a spent Claude subscription was stored as a
    // successful empty turn and the session went back to idle with nothing to show for it.
    it('ends a turn the provider errored out on exactly once', async () => {
        stream.parts = [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: new Error('Claude AI usage limit reached|1750000000') },
        ]

        const { outcome, run } = await runToSettlement('spend the subscription')

        expect(outcome.kind).toBe('error')
        expect(outcome.errorCode).toBe('provider_usage_limit')
        expect((await getRun(id, run.runId))?.status).toBe('error')
        expect(sent.filter(n => n.event === 'agent.message.completed')).toHaveLength(1)
    })

    // What the stream retry middleware ends a step on when the hub hung up and the step could not be
    // replayed. It used to arrive as `other` with no usage and pass for a finished turn.
    it('fails a turn whose stream was cut, keeping what it already said', async () => {
        stream.parts = textTurn({ unified: 'error', raw: STREAM_CUT_RAW_REASON })

        const { outcome, run, sessionId } = await runToSettlement('get cut off')

        expect(outcome.kind).toBe('error')
        expect(outcome.errorCode).toBe('provider_stream_incomplete')
        expect((await getRun(id, run.runId))?.error).toContain('ended the turn without a result')
        expect(JSON.stringify(await listMessages(id, sessionId))).toContain('partial answer')
    })

    it('frees the conversation so the next message is accepted', async () => {
        stream.parts = [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: new Error('boom') },
        ]

        const { sessionId } = await runToSettlement('fail')

        expect(sessionClaim(sessionId)).toBeNull()
        expect(claimSession(sessionId, 'next-run')).toBeNull()
    })

    // Stop before the first step is the one path streamText answers with `onAbort` alone.
    it('cancels a hung run on demand and tells the hub the conversation is over', async () => {
        stream.hang = true
        stream.parts = [{ type: 'stream-start', warnings: [] }]

        const session = await createSession(id, 'hang')
        const agent = await getAgent(id)
        const run = await runAgent(agent, session.id, 'hang')

        expect(abortRun(run.runId)).not.toBeNull()
        const outcome = await run.settled

        expect(outcome.kind).toBe('cancelled')
        expect((await getRun(id, run.runId))?.status).toBe('cancelled')
        const completion = sent.find(n => n.event === 'agent.message.completed')
        // `done` is what puts the session back to idle on the hub; `cancelled` in the metadata is
        // what keeps it out of the notification inbox.
        expect(completion?.kind).toBe('done')
        expect((completion?.metadata as Record<string, unknown>).status).toBe('cancelled')
        expect(sessionClaim(session.id)).toBeNull()
    })

    // The order is the point: the hub puts the conversation back to idle on `done`, so a proposal
    // announced first would be cleared by the run that made it.
    it('announces a skill proposal after the run is over', async () => {
        stream.parts = textTurn({ unified: 'stop' })
        proposal.push = true

        const { outcome } = await runToSettlement('always end a post with a CTA')

        expect(outcome.kind).toBe('done')
        // `settled` resolves before the hub is told anything.
        await vi.waitFor(() => expect(sent).toHaveLength(2))
        expect(sent.map(n => [n.event, n.kind])).toEqual([
            ['agent.message.completed', 'done'],
            ['agent.notification', 'approval'],
        ])
        expect(sent[1].message).toBe('Wants to save a new skill: Publishing checklist')
        expect(sent[1].metadata).toEqual({ toolName: 'skill_propose', proposalId: 'proposal-1' })
    })

    it('names the member who sent the message on the proposal and on the completion', async () => {
        stream.parts = textTurn({ unified: 'stop' })
        proposal.push = true

        await runToSettlement('always end a post with a CTA', { id: 'u1', name: 'Marie' })

        await vi.waitFor(() => expect(sent).toHaveLength(2))
        expect(sent.map(n => (n.metadata as Record<string, unknown>).authorId)).toEqual(['u1', 'u1'])
    })

    it('says nothing of a proposal made by a run that failed', async () => {
        stream.parts = [
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: new Error('boom') },
        ]
        proposal.push = true

        await runToSettlement('fail after proposing')

        await vi.waitFor(() => expect(sent.some(n => n.event === 'agent.message.completed')).toBe(true))
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(sent.filter(n => n.event === 'agent.notification')).toHaveLength(0)
    })

    it('keeps what delegated tasks had already produced when the run is stopped', async () => {
        stream.hang = true
        stream.parts = [{ type: 'stream-start', warnings: [] }]
        partial.push = true

        const session = await createSession(id, 'hang with results')
        const run = await runAgent(await getAgent(id), session.id, 'hang')
        expect(abortRun(run.runId)).not.toBeNull()
        expect((await run.settled).kind).toBe('cancelled')

        const kept = JSON.stringify(await listMessages(id, session.id))
        expect(kept).toContain('Run stopped by the user')
        expect(kept).toContain('four brands found')
    })

    it('lets Stop free the conversation of a run whose end failed on the way', async () => {
        ending.fails = true
        stream.parts = textTurn({ unified: 'stop' })
        const session = await createSession(id, 'ends badly')
        const run = await runAgent(await getAgent(id), session.id, 'go')
        claimSession(session.id, run.runId)
        await vi.waitFor(async () => expect((await listMessages(id, session.id)).map(row => row.role)).toContain('assistant'))

        await abortRun(run.runId)
        expect(sessionClaim(session.id)).toBeNull()
    })

    describe('a run stopped half way', () => {
        const said = [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: '0' },
            { type: 'text-delta', id: '0', delta: 'Snipd gave 11 snips.' },
            { type: 'text-end', id: '0' },
        ]
        const call = (toolCallId: string, toolName: string) => ({ type: 'tool-call', toolCallId, toolName, input: '{}', providerExecuted: true, dynamic: true })
        const answer = (toolCallId: string, toolName: string) => ({ type: 'tool-result', toolCallId, toolName, result: { episodes: 3 }, dynamic: true })

        async function stopAfter(parts: unknown[], calledBy?: string) {
            stream.hang = true
            stream.parts = parts
            const session = await createSession(id, 'digest')
            const agent = await getAgent(id)
            const run = await runAgent(agent, session.id, 'Digest: run', undefined, undefined, undefined, { source: 'chat', calledBy })
            await vi.waitFor(() => expect(prompts).toHaveLength(1))
            await new Promise(resolve => setTimeout(resolve, 50))
            return { run, agent, sessionId: session.id }
        }

        const stored = async (sessionId: string) => (await listMessages(id, sessionId)).map(row => ({ role: row.role, content: JSON.parse(row.contentJson) }))

        async function nextPrompt(agent: Awaited<ReturnType<typeof getAgent>>, sessionId: string) {
            stream.hang = false
            stream.parts = textTurn({ unified: 'stop' })
            const next = await runAgent(agent, sessionId, 'Why is this')
            await next.settled
            return prompts.at(-1)!
        }

        it('keeps what it said and did, and the next turn reads it', async () => {
            const { run, agent, sessionId } = await stopAfter([...said, call('c1', 'mcp__snipd__snips_list'), answer('c1', 'mcp__snipd__snips_list')])

            await abortRun(run.runId)
            expect((await run.settled).kind).toBe('cancelled')

            const kept = await stored(sessionId)
            expect(kept.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
            expect(JSON.stringify(kept)).toContain('"episodes":3')

            const prompt = await nextPrompt(agent, sessionId)
            expect(prompt).toContain('Snipd gave 11 snips.')
            expect(prompt).toContain('"episodes":3')
            expect(prompt).toContain(stoppedTurnNote('the user'))
        })

        it('holds the next message until the turn is stored', async () => {
            storage.delayMs = 150
            const { run, agent, sessionId } = await stopAfter(said)
            claimSession(sessionId, run.runId)

            const stopping = abortRun(run.runId)
            expect(claimSession(sessionId, 'next')).toBe(run.runId)
            await stopping
            expect(sessionClaim(sessionId)).toBeNull()

            expect(await nextPrompt(agent, sessionId)).toContain('Snipd gave 11 snips.')
        })

        it('does not say the user stopped a run another coworker called', async () => {
            const { run, sessionId } = await stopAfter([...said, call('c1', 'mcp__gmail__GMAIL_SEND_EMAIL')], 'caller')
            await abortRun(run.runId)

            const kept = JSON.stringify(await stored(sessionId))
            expect(kept).toContain(stoppedTurnNote('the user or the calling coworker'))
            expect(kept).toContain(stoppedCallResult('the user or the calling coworker'))
        })

        it('says which call was cut before its result', async () => {
            const { run, agent, sessionId } = await stopAfter([...said, call('c1', 'mcp__gmail__GMAIL_SEND_EMAIL')])
            await abortRun(run.runId)

            expect(await nextPrompt(agent, sessionId)).toContain(stoppedCallResult('the user'))
        })

        it('leaves no card waiting', async () => {
            const { run, sessionId } = await stopAfter([...said, call('c1', 'mcp__rerun__ask_user'), answer('c1', 'mcp__rerun__ask_user')])
            await abortRun(run.runId)

            const kept = await stored(sessionId)
            expect(findPendingHitl(kept as never)).toBeNull()
            expect(JSON.stringify(kept)).toContain('Snipd gave 11 snips.')
        })

        it('stores nothing of a turn that had only thought', async () => {
            const { run, sessionId } = await stopAfter([
                { type: 'stream-start', warnings: [] },
                { type: 'reasoning-start', id: 'r' },
                { type: 'reasoning-delta', id: 'r', delta: 'Let me see.' },
            ])
            await abortRun(run.runId)

            expect((await stored(sessionId)).map(message => message.role)).toEqual(['user'])
        })

        it('keeps the turn beside the results of its delegated tasks', async () => {
            partial.push = true
            const { run, sessionId } = await stopAfter(said)
            await abortRun(run.runId)

            const kept = JSON.stringify(await stored(sessionId))
            expect(kept.match(/Snipd gave 11 snips/g)).toHaveLength(1)
            expect(kept.match(/four brands found/g)).toHaveLength(1)
        })
    })
})
