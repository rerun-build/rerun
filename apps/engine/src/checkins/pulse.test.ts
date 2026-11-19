import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-pulse-'))
process.env.RERUN_API_KEY = 'pulse-key'
process.env.RERUN_LOG_LEVEL = 'fatal'

const state = vi.hoisted(() => ({ decision: 'checkin' as 'checkin' | 'skip' | 'ask', triage: false, started: [] as string[], live: false, digests: 0 }))

vi.mock('./digest.js', () => ({ buildDigest: async () => (state.digests++, { workspaceAgeDays: 1 }) }))
vi.mock('./rules.js', () => ({ decide: () => state.decision }))
vi.mock('./triage.js', () => ({ askTriage: async () => state.triage }))
vi.mock('./run.js', () => ({ checkinInFlight: () => false, startCheckin: async (reason: string) => (state.started.push(reason), { runId: 'r', sessionId: 's' }) }))
vi.mock('../runtime/run-control.js', async importOriginal => ({ ...(await importOriginal<typeof import('../runtime/run-control.js')>()), agentHasLiveRun: () => state.live }))

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { FOREMAN_AGENT_ID } = await import('@rerun/contracts')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { touchMember } = await import('../db/repos/members.js')
const { getSystemDb } = await import('../db/systemDb.js')
const { nextPulseAt, runPulseIfDue } = await import('./pulse.js')

// Paris is UTC+1 in November: 12:00 UTC is 13:00 there, well inside every box's window.
const NOON_IN_PARIS = new Date('2026-11-19T12:00:00.000Z')

async function forgetToday() {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    await client.execute("DELETE FROM system_meta WHERE key = 'checkin.pulse.day'")
}

beforeAll(async () => {
    await migrate()
    await ensureForeman()
})

beforeEach(async () => {
    state.decision = 'checkin'
    state.triage = false
    state.started = []
    state.live = false
    state.digests = 0
    await forgetToday()
})

describe('the daily pulse', () => {
    it('waits for a time zone: nobody has written yet', async () => {
        await runPulseIfDue(NOON_IN_PARIS)
        expect(state.digests).toBe(0)
    })

    it("is taken once a day, in the owner's daytime, and starts the check-in the rules owe", async () => {
        await touchMember({ id: 'u-owner', name: 'Owner', timezone: 'Europe/Paris' }, '2026-11-01T08:00:00.000Z')
        await touchMember({ id: 'u-late', name: 'Late', timezone: 'Pacific/Auckland' }, '2026-11-10T08:00:00.000Z')
        await runPulseIfDue(NOON_IN_PARIS)
        await runPulseIfDue(new Date('2026-11-19T15:00:00.000Z'))
        expect(state.started).toEqual(['pulse'])
        expect(state.digests).toBe(1)
        await runPulseIfDue(new Date('2026-11-20T12:00:00.000Z'))
        expect(state.started).toEqual(['pulse', 'pulse'])
    })

    it('never pulses at night or before the day starts where the owner is', async () => {
        await runPulseIfDue(new Date('2026-11-19T02:00:00.000Z'))
        await runPulseIfDue(new Date('2026-11-19T07:30:00.000Z'))
        await runPulseIfDue(new Date('2026-11-19T17:30:00.000Z'))
        expect(state.digests).toBe(0)
    })

    it('tries again on a later tick when the Chief of Staff is busy', async () => {
        state.live = true
        await runPulseIfDue(NOON_IN_PARIS)
        expect(state.digests).toBe(0)
        state.live = false
        await runPulseIfDue(NOON_IN_PARIS)
        expect(state.started).toEqual(['pulse'])
    })

    it('asks the triage about a grey day, and checks in only on its yes', async () => {
        state.decision = 'ask'
        await runPulseIfDue(NOON_IN_PARIS)
        expect(state.started).toEqual([])
        await forgetToday()
        state.triage = true
        await runPulseIfDue(NOON_IN_PARIS)
        expect(state.started).toEqual(['pulse'])
    })

    it('starts nothing on a day the rules skip, nor once its switch is off', async () => {
        state.decision = 'skip'
        await runPulseIfDue(NOON_IN_PARIS)
        expect(state.started).toEqual([])
        await forgetToday()
        state.decision = 'checkin'
        const { createServer } = await import('../http/server.js')
        const res = await createServer().request(`/agents/${FOREMAN_AGENT_ID}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer pulse-key' }, body: JSON.stringify({ proactive: { enabled: false } }) })
        expect([res.status, await res.text()]).toEqual([200, expect.any(String)])
        await runPulseIfDue(NOON_IN_PARIS)
        expect(state.started).toEqual([])
    })

    it("says when it next looks: later today before it has, tomorrow once it has", async () => {
        const morning = new Date('2026-11-19T06:00:00.000Z')
        const next = await nextPulseAt(morning)
        expect(next!.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-11-19T08:00:00.000Z'))
        expect(next!.getTime()).toBeLessThan(Date.parse('2026-11-19T10:00:00.000Z'))
        const { client } = await getSystemDb(FOREMAN_AGENT_ID)
        await client.execute("INSERT INTO system_meta (key, value) VALUES ('checkin.pulse.day', '2026-11-19')")
        const tomorrow = await nextPulseAt(NOON_IN_PARIS)
        expect(tomorrow!.toISOString().slice(0, 10)).toBe('2026-11-20')
    })
})

