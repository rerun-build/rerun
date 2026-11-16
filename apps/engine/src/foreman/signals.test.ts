import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-foreman-signals-'))
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_API_KEY = ''

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { createAgent } = await import('../agents/factory.js')
const { sendNotification } = await import('../runtime/notify.js')
const { EMPTY_WAKE_STATE, readWakeState, writeWakeState } = await import('./wake-state.js')
const { clearAwaitingSignal, installForemanSignals, recordSignal, signalOf } = await import('./signals.js')

let scout: string
let sub: string

beforeAll(async () => {
    await migrate()
    await ensureForeman()
    scout = (await createAgent({ config: { name: 'scout', displayName: 'Scout' } })).id
    sub = (await createAgent({ config: { name: 'sub-task', ephemeral: true } })).id
})

beforeEach(async () => {
    await writeWakeState({ ...EMPTY_WAKE_STATE, planned: [], log: [], signals: [] })
})

const failed = (agentId: string, over: Record<string, unknown> = {}) => ({ event: 'agent.message.completed' as const, kind: 'error' as const, agentId, sessionId: 'sess-1', runId: 'run-1', message: 'Message failed: 401 from Gmail', metadata: { status: 'error', authorId: 'member-1' }, ...over })

describe('signalOf', () => {
    it("hears a coworker's failed run, for the member who started it", async () => {
        expect(await signalOf(failed(scout))).toMatchObject({ kind: 'run_failed', agentId: scout, sessionId: 'sess-1', memberId: 'member-1' })
    })

    // Its own failures, and those of the sub-coworkers of a delegated task, would wake it in a loop.
    it('ignores its own events and those of a sub-coworker', async () => {
        expect(await signalOf(failed('foreman'))).toBeNull()
        expect(await signalOf(failed(sub))).toBeNull()
        expect(await signalOf(failed('gone-agent'))).toBeNull()
    })

    it('ignores a run stopped on purpose, and groups the runs a restart cut short', async () => {
        expect(await signalOf(failed(scout, { metadata: { status: 'cancelled' } }))).toBeNull()
        expect(await signalOf(failed(scout, { metadata: { status: 'error', errorCode: 'engine_restarted' } }))).toMatchObject({ kind: 'runs_interrupted' })
    })

    it('hears a conversation waiting on someone, only after four hours, and never a skill proposal', async () => {
        const waiting = { event: 'agent.notification' as const, kind: 'approval' as const, agentId: scout, sessionId: 'sess-2', runId: 'run-2', message: 'Send 10 emails', metadata: { toolName: 'request_approval' } }
        expect(await signalOf(waiting)).toMatchObject({ kind: 'awaiting_human', delayMs: 4 * 60 * 60_000 })
        expect(await signalOf({ ...waiting, metadata: { toolName: 'skill_propose' } })).toBeNull()
        expect(await signalOf({ ...waiting, kind: 'info', metadata: {} })).toBeNull()
    })

    it('hears an app signed out of the Vault, one per entry, and an AI connection added', async () => {
        expect(await signalOf({ event: 'box.vault.signed_out', kind: 'connector', agentId: null, message: 'Gmail', metadata: { itemId: 'item-1' } })).toMatchObject({ kind: 'vault_signed_out', itemId: 'item-1' })
        expect(await signalOf({ event: 'box.connection.connected', kind: 'info', agentId: null, message: 'claude' })).toMatchObject({ kind: 'provider_connected' })
    })

    it('stays deaf to everything else', async () => {
        expect(await signalOf({ ...failed(scout), kind: 'done', metadata: { status: 'done' } })).toBeNull()
        expect(await signalOf({ event: 'agent.session.created', kind: 'info', agentId: scout, sessionId: 's', runId: null, message: 'x' })).toBeNull()
    })
})

describe('the queue', () => {
    it('counts five failures of one conversation as one signal, and keeps two apps apart', async () => {
        for (let i = 0; i < 5; i++) await recordSignal({ kind: 'run_failed', agentId: scout, sessionId: 'sess-1', summary: `failure ${i}` })
        await recordSignal({ kind: 'vault_signed_out', itemId: 'item-1', summary: 'Gmail' })
        await recordSignal({ kind: 'vault_signed_out', itemId: 'item-2', summary: 'Notion' })
        const { signals } = await readWakeState()
        expect(signals).toHaveLength(3)
        expect(signals[0]).toMatchObject({ count: 5, summary: 'failure 4' })
    })

    it('lets a reply in the conversation cancel what it was waiting on', async () => {
        await recordSignal({ kind: 'awaiting_human', agentId: scout, sessionId: 'sess-2', summary: 'waiting' })
        await recordSignal({ kind: 'awaiting_human', agentId: scout, sessionId: 'sess-3', summary: 'other' })
        await clearAwaitingSignal(scout, 'sess-2')
        expect((await readWakeState()).signals.map(signal => signal.sessionId)).toEqual(['sess-3'])
    })

    it('keeps at most fifty signals, the latest', async () => {
        for (let i = 0; i < 55; i++) await recordSignal({ kind: 'run_failed', agentId: scout, sessionId: `s-${i}`, summary: 'x' })
        const { signals } = await readWakeState()
        expect(signals).toHaveLength(50)
        expect(signals.at(-1)?.sessionId).toBe('s-54')
    })

    it('hears what goes through sendNotification once installed', async () => {
        const uninstall = installForemanSignals()
        await sendNotification(failed(scout))
        await new Promise(resolve => setTimeout(resolve, 50))
        uninstall()
        expect((await readWakeState()).signals.map(signal => signal.kind)).toEqual(['run_failed'])
    })
})
