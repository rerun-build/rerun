import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-run-events-'))

const { sent, delivery } = vi.hoisted(() => ({
    sent: [] as Array<Record<string, unknown>>,
    delivery: { reject: false },
}))

vi.mock('./notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./notify.js')>()),
    sendNotification: async (input: Record<string, unknown>) => {
        if (delivery.reject) throw new Error('hub down')
        sent.push(input)
        return { delivered: true }
    },
}))

const { afterEach, describe, expect, it } = await import('vitest')
const { emitRunTerminal, triggerFromRun } = await import('./run-events.js')
const { readCheckinLog, writeCheckinLog } = await import('../checkins/log.js')
const { startRun } = await import('../db/repos/runs.js')
type RunTerminal = import('./run-events.js').RunTerminal

const base: RunTerminal = { agentId: 'a1', sessionId: 's1', runId: 'r1', trigger: { source: 'chat' }, kind: 'done' }
const schedule = { source: 'schedule', slug: 'daily', name: 'Daily digest' } as const
const trigger = { source: 'trigger', slug: 'hook', name: 'Inbound hook' } as const

async function emit(terminal: Partial<RunTerminal>) {
    await emitRunTerminal({ ...base, ...terminal })
    return sent.at(-1) as Record<string, unknown> & { metadata: Record<string, unknown> }
}

afterEach(() => {
    sent.length = 0
    delivery.reject = false
})

describe('triggerFromRun', () => {
    it('rebuilds a schedule trigger from its slug', () => {
        expect(triggerFromRun({ triggerSource: 'schedule', triggerSlug: 'daily' })).toEqual({ source: 'schedule', slug: 'daily', name: 'daily' })
    })

    it('rebuilds a webhook trigger from its slug', () => {
        expect(triggerFromRun({ triggerSource: 'trigger', triggerSlug: 'hook' })).toEqual({ source: 'trigger', slug: 'hook', name: 'hook' })
    })

    it('falls back to a generic label when the slug was never stored', () => {
        expect(triggerFromRun({ triggerSource: 'schedule', triggerSlug: null })).toEqual({ source: 'schedule', slug: '', name: 'schedule' })
        expect(triggerFromRun({ triggerSource: 'trigger', triggerSlug: null })).toEqual({ source: 'trigger', slug: '', name: 'trigger' })
    })

    it('treats anything else as a chat run', () => {
        expect(triggerFromRun({ triggerSource: 'chat', triggerSlug: null })).toEqual({ source: 'chat' })
        expect(triggerFromRun({ triggerSource: null, triggerSlug: 'x' })).toEqual({ source: 'chat' })
    })
})

describe('emitRunTerminal', () => {
    it('announces a finished schedule under its own event', async () => {
        const n = await emit({ trigger: schedule })

        expect(n.event).toBe('agent.schedule.completed')
        expect(n.message).toBe('Schedule "Daily digest" completed')
        expect(n.source).toBe('schedule')
        expect(n.metadata.scheduleSlug).toBe('daily')
        expect(n.metadata.triggerSlug).toBeUndefined()
    })

    it('hands the hub the final answer of an automated run, never of a chat', async () => {
        expect((await emit({ trigger: schedule, text: '  4 applications sent  ' })).metadata.finalText).toBe('4 applications sent')
        expect((await emit({ trigger, text: 'Reminder sent' })).metadata.finalText).toBe('Reminder sent')
        expect((await emit({ trigger: schedule, text: 'x'.repeat(5000) })).metadata.finalText).toHaveLength(2000)
        expect((await emit({ trigger: schedule, text: '   ' })).metadata.finalText).toBeUndefined()
        expect((await emit({ text: 'Hello' })).metadata.finalText).toBeUndefined()
    })

    it('describes a failed or stopped schedule', async () => {
        expect((await emit({ trigger: schedule, kind: 'error', error: 'boom' })).message).toBe('Schedule "Daily digest" failed: boom')
        expect((await emit({ trigger: schedule, kind: 'error' })).message).toBe('Schedule "Daily digest" failed: unknown error')
        expect((await emit({ trigger: schedule, cancelled: true })).message).toBe('Schedule "Daily digest" stopped')
    })

    it('announces a webhook trigger under its own event', async () => {
        const n = await emit({ trigger })

        expect(n.event).toBe('agent.trigger.completed')
        expect(n.message).toBe('Trigger "Inbound hook" completed')
        expect(n.source).toBe('trigger')
        expect(n.metadata.triggerSlug).toBe('hook')
        expect(n.metadata.scheduleSlug).toBeUndefined()
    })

    it('describes a failed or stopped trigger', async () => {
        expect((await emit({ trigger, kind: 'error', error: 'bad' })).message).toBe('Trigger "Inbound hook" failed: bad')
        expect((await emit({ trigger, kind: 'error' })).message).toBe('Trigger "Inbound hook" failed: unknown error')
        expect((await emit({ trigger, cancelled: true })).message).toBe('Trigger "Inbound hook" stopped')
    })

    it('uses the answer itself as the message of a chat run, trimmed to 200 characters', async () => {
        const n = await emit({ text: `   ${'a'.repeat(250)}  ` })

        expect(n.event).toBe('agent.message.completed')
        expect(n.message).toBe('a'.repeat(200))
        expect(n.source).toBeNull()
    })

    it('falls back to a generic message when a chat run said nothing', async () => {
        expect((await emit({ text: '   ' })).message).toBe('Message completed')
        expect((await emit({})).message).toBe('Message completed')
    })

    it('describes a failed or stopped chat run', async () => {
        expect((await emit({ kind: 'error', error: 'nope' })).message).toBe('Message failed: nope')
        expect((await emit({ kind: 'error' })).message).toBe('Message failed: unknown error')
        expect((await emit({ cancelled: true, text: 'half' })).message).toBe('Message stopped')
    })

    it('reports cancelled as the status while keeping the kind', async () => {
        const n = await emit({ cancelled: true })

        expect(n.kind).toBe('done')
        expect(n.metadata.status).toBe('cancelled')
        expect((await emit({ kind: 'error', error: 'x' })).metadata.status).toBe('error')
        expect((await emit({})).metadata.status).toBe('done')
    })

    it('carries the error and its code only when present', async () => {
        const failed = await emit({ kind: 'error', error: 'limit', errorCode: 'provider_usage_limit' })
        expect(failed.metadata.error).toBe('limit')
        expect(failed.metadata.errorCode).toBe('provider_usage_limit')

        const ok = await emit({})
        expect('error' in ok.metadata).toBe(false)
        expect('errorCode' in ok.metadata).toBe(false)
    })

    // In a workspace of several members, the hub otherwise credits every run to the owner.
    it('names who sent the message of a chat run, and nobody for a schedule', async () => {
        expect((await emit({ trigger: { source: 'chat', author: { id: 'u2', name: 'Sam' } } })).metadata.authorId).toBe('u2')
        expect('authorId' in (await emit({})).metadata).toBe(false)
        expect('authorId' in (await emit({ trigger: schedule })).metadata).toBe(false)
    })

    // The hub writes the notification in the reader's language from these, not from the English message.
    it('names the routine on its own, and nothing for a chat run', async () => {
        expect((await emit({ trigger: schedule, kind: 'error', error: 'boom' })).metadata).toMatchObject({ sourceName: schedule.name, error: 'boom' })
        expect('sourceName' in (await emit({})).metadata).toBe(false)
    })

    it('fills the run facts and defaults the missing ones to null', async () => {
        const full = await emit({ usage: { totalTokens: 3 }, stepCount: 2, provider: 'openai', model: 'gpt', costMicros: 42 })
        expect(full).toMatchObject({ agentId: 'a1', sessionId: 's1', runId: 'r1' })
        expect(full.metadata).toEqual({ source: 'chat', status: 'done', stepCount: 2, usage: { totalTokens: 3 }, provider: 'openai', model: 'gpt', costMicros: 42 })

        const bare = await emit({ runId: null })
        expect(bare.runId).toBeNull()
        expect(bare.metadata).toEqual({ source: 'chat', status: 'done', stepCount: undefined, usage: null, provider: null, model: null, costMicros: null })
    })

    it('swallows a notification that fails to send', async () => {
        delivery.reject = true
        await expect(emitRunTerminal(base)).resolves.toBeUndefined()
    })
})

describe('the end of a check-in', () => {
    const checkin = { source: 'checkin', slug: 'checkin', name: 'Check-in', reason: 'pulse' } as const

    it('tells the hub nothing and keeps what it concluded in its log', async () => {
        await startRun('foreman', 's-checkin', 'r-checkin')
        await writeCheckinLog('r-checkin', { reason: 'pulse' })
        await emitRunTerminal({ ...base, agentId: 'foreman', sessionId: 's-checkin', runId: 'r-checkin', trigger: checkin, kind: 'done', text: '  Nothing new today.  ' })
        expect(sent).toEqual([])
        expect(await readCheckinLog('r-checkin')).toEqual({ reason: 'pulse', note: 'Nothing new today.' })
    })

    it('stays silent for one the boot found interrupted, its reason read back from its log', async () => {
        await startRun('foreman', 's-orphan', 'r-orphan')
        await writeCheckinLog('r-orphan', { reason: 'promise' })
        const trigger = triggerFromRun({ triggerSource: 'checkin', triggerSlug: 'follow-up', checkinJson: JSON.stringify({ reason: 'promise' }) })
        expect(trigger).toEqual({ source: 'checkin', slug: 'follow-up', name: 'follow-up', reason: 'promise' })
        await emitRunTerminal({ ...base, agentId: 'foreman', sessionId: 's-orphan', runId: 'r-orphan', trigger, kind: 'error', error: 'interrupted: engine restarted' })
        expect(sent).toEqual([])
        expect(await readCheckinLog('r-orphan')).toEqual({ reason: 'promise', note: 'Failed: interrupted: engine restarted' })
    })
})
