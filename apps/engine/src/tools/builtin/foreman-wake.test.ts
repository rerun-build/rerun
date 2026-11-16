import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-wake-tools-'))

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { migrate } = await import('../../db/migrate.js')
const { ensureForeman } = await import('../../agents/foreman.js')
const { EMPTY_WAKE_STATE, readWakeState, writeWakeState } = await import('../../foreman/wake-state.js')
const { foremanWakeTools } = await import('./foreman-wake.js')

const run = (name: 'schedule_wake' | 'cancel_wake', input: unknown) => (foremanWakeTools()[name] as { execute: (input: unknown, options: unknown) => Promise<Record<string, unknown>> }).execute(input, { toolCallId: 't', messages: [] })

beforeAll(async () => {
    await migrate()
    await ensureForeman()
})

beforeEach(async () => {
    await writeWakeState({ ...EMPTY_WAKE_STATE, planned: [], log: [], timezone: 'UTC' })
})

describe('schedule_wake', () => {
    it('plans a wake with its reason and says when it lands', async () => {
        const out = await run('schedule_wake', { reason: 'Check that Scout finished its install', inMinutes: 60 })
        expect(out).toMatchObject({ id: expect.any(String), at: expect.any(String) })
        expect((await readWakeState()).planned).toEqual([{ id: out.id, at: out.at, reason: 'Check that Scout finished its install' }])
    })

    it('says why a wake moved', async () => {
        const out = await run('schedule_wake', { reason: 'Too soon', inMinutes: 2 })
        expect(out.moved).toContain('fifteen minutes')
    })

    it('refuses a date it cannot read', async () => {
        expect(await run('schedule_wake', { reason: 'Nowhen', at: 'tomorrow-ish' })).toHaveProperty('error')
    })

    it('cancels a planned wake by its id', async () => {
        const planned = await run('schedule_wake', { reason: 'x', inMinutes: 60 })
        expect(await run('cancel_wake', { id: planned.id })).toEqual({ cancelled: planned.id })
        expect((await readWakeState()).planned).toEqual([])
        expect(await run('cancel_wake', { id: planned.id })).toHaveProperty('error')
    })
})
