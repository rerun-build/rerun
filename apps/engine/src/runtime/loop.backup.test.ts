import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-backup-'))

// Each connection answers its own way: the test says which one is out of its subscription.
const { sent, answers, prompts, signals } = vi.hoisted(() => ({
    sent: [] as Array<Record<string, unknown>>,
    answers: new Map<string, 'limit' | 'limit-after-text' | 'limit-after-tools' | 'ok'>(),
    prompts: [] as Array<{ connectionId: string; prompt: string }>,
    signals: [] as AbortSignal[],
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

vi.mock('../tools/registry.js', () => ({
    buildTools: async (ctx: { abortSignal: AbortSignal }) => {
        signals.push(ctx.abortSignal)
        return { tools: {}, close: async () => {} }
    },
}))

const finish = { type: 'finish', finishReason: { unified: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: (agent: { resolved: { connection: { id: string } | null; model: string } }) => {
            const connectionId = agent.resolved.connection?.id ?? ''
            const answer = answers.get(connectionId) ?? 'ok'
            const parts: unknown[] = [{ type: 'stream-start', warnings: [] }]
            if (answer === 'limit-after-text') parts.push({ type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'Pulling the deals.' }, { type: 'text-end', id: '0' })
            // The Claude Code CLI: its whole tool loop is one step, and a spent plan is thrown at its end.
            if (answer === 'limit-after-tools')
                parts.push(
                    { type: 'text-start', id: '0' },
                    { type: 'text-delta', id: '0', delta: 'Writing the report.' },
                    { type: 'text-end', id: '0' },
                    { type: 'tool-call', toolCallId: 'toolu_1', toolName: 'mcp__rerun__fs_write', input: JSON.stringify({ path: 'report.md' }), providerExecuted: true },
                    { type: 'tool-result', toolCallId: 'toolu_1', toolName: 'mcp__rerun__fs_write', result: { written: 'report.md' }, providerExecuted: true },
                )
            if (answer === 'ok') parts.push({ type: 'text-start', id: '1' }, { type: 'text-delta', id: '1', delta: `answered by ${agent.resolved.model}` }, { type: 'text-end', id: '1' }, finish)
            else if (answer === 'limit-after-text') parts.push({ ...finish, finishReason: { unified: 'other', raw: 'usage_limit_exceeded' } })
            else parts.push({ type: 'error', error: new Error("You've hit your session limit · resets 4:40pm") })
            return {
                model: new MockLanguageModelV3({
                    doStream: async ({ prompt }) => {
                        prompts.push({ connectionId, prompt: JSON.stringify(prompt) })
                        return {
                            stream: new ReadableStream({
                                start(controller) {
                                    for (const part of parts) controller.enqueue(part)
                                    controller.close()
                                },
                            }),
                        }
                    },
                }),
                close: async () => {},
            }
        },
    }
})

const { afterEach, beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { readProviderSwitchEntry } = await import('@rerun/contracts')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { clearAgentCache, getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { getRun } = await import('../db/repos/runs.js')
const { listMessages } = await import('../db/repos/messages.js')
const { createConnection } = await import('../connections/store.js')
const { clearBoxBackups, writeBoxBackups } = await import('../connections/backups.js')
const { armPlanLimitLatch, clearPlanLimitLatch, isPlanLimitLatched } = await import('../connections/plan-limits.js')
const { runAgent } = await import('./loop.js')
const { sessionClaim } = await import('./run-control.js')
const { mergeRunStream } = await import('./run-stream-merge.js')

const id = 'backupagent'
let primary: string
let backup: string
let second: string

async function connect(name: string): Promise<string> {
    const connection = await createConnection({ name, provider: 'anthropic', models: ['claude-opus-4-8', 'claude-sonnet-4-8'], extraModels: [], keys: { ANTHROPIC_API_KEY: 'sk-ant-test' } } as never)
    return connection.id
}

async function send(message: string, sessionId?: string) {
    const session = sessionId ?? (await createSession(id, message)).id
    const run = await runAgent(await getAgent(id), session, message, undefined, undefined, undefined, { source: 'chat' })
    return { run, sessionId: session, outcome: await run.settled }
}

async function chain(run: Awaited<ReturnType<typeof send>>['run']) {
    const attempts = [run]
    let outcome = await run.attempt
    while (outcome.kind === 'handover') {
        attempts.push(outcome.next)
        outcome = await outcome.next.attempt
    }
    return attempts
}

const storedSwitches = (rows: Awaited<ReturnType<typeof listMessages>>) => rows.flatMap(row => (row.toolCallsJson ? (JSON.parse(row.toolCallsJson) as unknown[]).map(readProviderSwitchEntry).filter(Boolean) : []))

describe('a turn whose subscription runs out moves to a backup', () => {
    beforeAll(async () => {
        await migrate()
        primary = await connect('Claude')
        backup = await connect('Work Claude')
        second = await connect('Spare Claude')
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'backup', connectionId: primary, provider: 'anthropic', model: 'claude-opus-4-8' }))
    })

    beforeEach(async () => {
        clearAgentCache()
        await writeBoxBackups({
            backups: [
                { connectionId: backup, model: 'claude-sonnet-4-8' },
                { connectionId: second, model: 'claude-opus-4-8' },
            ],
            rerunCreditLastResort: false,
        })
    })

    afterEach(async () => {
        sent.length = 0
        prompts.length = 0
        signals.length = 0
        answers.clear()
        for (const connection of [primary, backup, second]) clearPlanLimitLatch(connection)
        await clearBoxBackups()
    })

    it('fails as before when no backup is set', async () => {
        await clearBoxBackups()
        answers.set(primary, 'limit')

        const { outcome, run } = await send('draft the report')

        expect(outcome).toMatchObject({ kind: 'error', errorCode: 'provider_usage_limit' })
        expect(await run.attempt).toMatchObject({ kind: 'error' })
        expect(isPlanLimitLatched(primary)).toBe(true)
    })

    it('carries the turn on to the first backup, in the same run, with the user message stored once', async () => {
        answers.set(primary, 'limit')

        const { outcome, run, sessionId } = await send('draft the report')
        const attempts = await chain(run)

        expect(outcome.kind).toBe('done')
        expect(attempts.map(attempt => attempt.runId)).toEqual([run.runId, run.runId])
        expect(attempts[1]).toMatchObject({ model: 'claude-sonnet-4-8', providerSwitch: { kind: 'switch', from: { connectionId: primary, name: 'Claude' }, to: { connectionId: backup, model: 'claude-sonnet-4-8' } } })
        expect((await getRun(id, run.runId))?.status).toBe('done')
        expect(sessionClaim(sessionId)).toBeNull()

        const rows = await listMessages(id, sessionId)
        expect(rows.filter(row => row.role === 'user')).toHaveLength(1)
        expect(rows.at(-1)?.contentJson).toContain('answered by claude-sonnet-4-8')
        expect(storedSwitches(rows)).toEqual([expect.objectContaining({ kind: 'switch', to: expect.objectContaining({ connectionId: backup }) })])
        // The hub hears about one run, once, and only once it is over.
        const completions = sent.filter(n => n.event === 'agent.message.completed')
        expect(completions).toHaveLength(1)
        expect(completions[0].kind).not.toBe('error')
    })

    it('stops what is left of the first attempt, and only that', async () => {
        answers.set(primary, 'limit')

        const { outcome } = await send('draft the report')

        expect(outcome.kind).toBe('done')
        expect(signals.map(signal => signal.aborted)).toEqual([true, false])
    })

    it('shows the chat no abort before the answer of the backup', async () => {
        answers.set(primary, 'limit')

        const { run } = await send('draft the report')
        const types: string[] = []
        let merged!: ReadableStream<{ type: string }>
        mergeRunStream({ merge: (stream: typeof merged) => (merged = stream), write() {} } as never, run)
        const reader = merged.getReader()
        for (let next = await reader.read(); !next.done; next = await reader.read()) types.push(next.value.type)

        expect(types).not.toContain('abort')
        expect(types).not.toContain('error')
        expect(types).toContain('text-delta')
        expect(types.at(-1)).toBe('finish')
    })

    it('keeps what the first model said and asks the backup to carry on', async () => {
        answers.set(primary, 'limit-after-text')

        const { outcome, sessionId } = await send('draft the report')

        expect(outcome.kind).toBe('done')
        const rows = await listMessages(id, sessionId)
        expect(rows.map(row => row.role)).toEqual(['user', 'assistant', 'assistant'])
        expect(rows[1].contentJson).toContain('Pulling the deals.')
        expect(storedSwitches(rows)).toHaveLength(1)
    })

    it('keeps the tools a turn ran before its plan ran out, and the backup carries on from them', async () => {
        answers.set(primary, 'limit-after-tools')

        const { outcome, sessionId } = await send('draft the report')

        expect(outcome.kind).toBe('done')
        const rows = await listMessages(id, sessionId)
        expect(rows.map(row => row.role).slice(0, 2)).toEqual(['user', 'assistant'])
        expect(rows[1].contentJson).toContain('mcp__rerun__fs_write')
        expect(rows[1].contentJson).toContain('Writing the report.')
        const backupPrompt = prompts.find(entry => entry.connectionId === backup)?.prompt
        expect(backupPrompt).toContain('mcp__rerun__fs_write')
        expect(backupPrompt).toContain('Continue from where it left off')
    })

    it('shows a model picked by hand after the limit what the cut turn already did', async () => {
        await clearBoxBackups()
        answers.set(primary, 'limit-after-tools')

        const cut = await send('draft the report')
        expect(cut.outcome).toMatchObject({ kind: 'error', errorCode: 'provider_usage_limit' })

        prompts.length = 0
        const picked = await runAgent(await getAgent(id), cut.sessionId, 'Continue where you left off.', { connectionId: backup, provider: 'anthropic', model: 'claude-sonnet-4-8' }, undefined, undefined, { source: 'chat' })
        expect((await picked.settled).kind).toBe('done')
        const pickedPrompt = prompts.find(entry => entry.connectionId === backup)?.prompt
        expect(pickedPrompt).toContain('mcp__rerun__fs_write')
        expect(pickedPrompt).toContain('Writing the report.')
    })

    it('skips a backup whose own subscription is out', async () => {
        answers.set(primary, 'limit')
        armPlanLimitLatch(backup)

        const { run } = await send('draft the report')
        const attempts = await chain(run)

        expect(attempts.at(-1)).toMatchObject({ providerSwitch: { to: { connectionId: second } } })
    })

    it('walks the list when the backup runs out too, then fails once every plan is out', async () => {
        answers.set(primary, 'limit')
        answers.set(backup, 'limit')
        answers.set(second, 'limit')

        const { outcome, run } = await send('draft the report')
        const attempts = await chain(run)

        expect(attempts).toHaveLength(3)
        expect(outcome).toMatchObject({ kind: 'error', errorCode: 'provider_usage_limit' })
        expect(sent.filter(n => n.event === 'agent.message.completed')).toHaveLength(1)
    })

    it('never spends the Rerun credit unless it is switched on', async () => {
        await writeBoxBackups({ backups: [], rerunCreditLastResort: false })
        answers.set(primary, 'limit')

        const { outcome } = await send('draft the report')

        expect(outcome.kind).toBe('error')
    })

    it('goes straight to the backup while the subscription is out, says it once, then says it is back', async () => {
        armPlanLimitLatch(primary)

        const first = await send('draft the report')
        expect(first.run).toMatchObject({ model: 'claude-sonnet-4-8', providerSwitch: { kind: 'switch' } })

        const again = await send('and the forecast', first.sessionId)
        expect(again.run.providerSwitch).toBeUndefined()

        clearPlanLimitLatch(primary)
        const back = await send('and next week', first.sessionId)
        expect(back.run).toMatchObject({ model: 'claude-opus-4-8', providerSwitch: { kind: 'back', from: { connectionId: backup }, to: { connectionId: primary } } })
        expect(storedSwitches(await listMessages(id, first.sessionId)).map(change => change?.kind)).toEqual(['switch', 'back'])
    })

    it('never says it is back while the subscription is still out and every backup is out too', async () => {
        armPlanLimitLatch(primary)
        const first = await send('draft the report')
        expect(first.run).toMatchObject({ providerSwitch: { kind: 'switch', to: { connectionId: backup } } })

        armPlanLimitLatch(backup)
        armPlanLimitLatch(second)
        answers.set(primary, 'limit')
        const stuck = await send('and the forecast', first.sessionId)

        expect(stuck.run.providerSwitch).toBeUndefined()
        expect(stuck.outcome).toMatchObject({ kind: 'error', errorCode: 'provider_usage_limit' })
        expect(storedSwitches(await listMessages(id, first.sessionId)).map(change => change?.kind)).toEqual(['switch'])
    })
})
