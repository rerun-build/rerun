import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-readings-'))

const { describe, expect, it, vi } = await import('vitest')
const { listReadings, saveReadings } = await import('./plan-readings.js')
const { forgetPlanLimits, readPlanLimits, recordPlanLimits, restorePlanLimits } = await import('./plan-limits.js')

describe('plan readings', () => {
    it('saves one row per window and lists them oldest first', async () => {
        await saveReadings(
            'c1',
            [
                { kind: 'weekly', label: null, usedPercent: 12.5, resetsAt: '2026-11-17T00:00:00.000Z' },
                { kind: 'session', label: null, usedPercent: 3, resetsAt: null }
            ],
            '2026-11-10T09:00:00.000Z'
        )
        const all = [...(await listReadings(null, 'weekly')), ...(await listReadings(null, 'session'))]
        expect(all).toHaveLength(2)
        expect(all.map(r => r.kind)).toEqual(['weekly', 'session'])
        expect(all[0]).toEqual({
            connectionId: 'c1',
            kind: 'weekly',
            label: '',
            usedPercent: 12.5,
            resetsAt: '2026-11-17T00:00:00.000Z',
            capturedAt: '2026-11-10T09:00:00.000Z'
        })
    })

    it('skips an identical reading and keeps a changed one', async () => {
        const weekly = { kind: 'weekly' as const, label: null, usedPercent: 12.5, resetsAt: '2026-11-17T00:00:00.000Z' }
        await saveReadings('c1', [weekly], '2026-11-10T10:00:00.000Z')
        expect(await listReadings(null, 'weekly')).toHaveLength(1)
        await saveReadings('c1', [{ ...weekly, usedPercent: 14.25 }], '2026-11-10T11:00:00.000Z')
        const rows = await listReadings(null, 'weekly')
        expect(rows).toHaveLength(2)
        expect(rows[1]!.usedPercent).toBe(14.25)
    })

    it('filters by kind and since across connections', async () => {
        await saveReadings('c2', [{ kind: 'weekly', label: null, usedPercent: 40, resetsAt: null }], '2026-11-10T12:00:00.000Z')
        const rows = await listReadings('2026-11-10T10:30:00.000Z', 'weekly')
        expect(rows.map(r => [r.connectionId, r.usedPercent])).toEqual([
            ['c1', 14.25],
            ['c2', 40]
        ])
    })

    it('recordPlanLimits stores the reading', async () => {
        recordPlanLimits('c3', [{ kind: 'weekly', label: null, usedPercent: 7, resetsAt: null }])
        await vi.waitFor(async () => {
            const rows = await listReadings(null, 'weekly')
            expect(rows.some(r => r.connectionId === 'c3' && r.usedPercent === 7)).toBe(true)
        })
        expect(readPlanLimits('c3')?.windows[0]?.usedPercent).toBe(7)
    })

    it('restores the newest saved reading of each window after a restart, and leaves a fresher one alone', async () => {
        const now = Date.parse('2026-11-12T00:00:00.000Z')
        await saveReadings('c4', [{ kind: 'weekly', label: null, usedPercent: 50, resetsAt: '2026-11-17T00:00:00.000Z' }, { kind: 'session', label: null, usedPercent: 9, resetsAt: null }], '2026-11-11T08:00:00.000Z')
        await saveReadings('c4', [{ kind: 'weekly', label: null, usedPercent: 50, resetsAt: '2026-11-17T00:00:00.000Z' }, { kind: 'session', label: null, usedPercent: 20, resetsAt: null }], '2026-11-11T09:00:00.000Z')
        await saveReadings('c5', [{ kind: 'weekly', label: null, usedPercent: 80, resetsAt: null }], '2026-10-01T09:00:00.000Z')
        recordPlanLimits('c3', [{ kind: 'weekly', label: null, usedPercent: 8, resetsAt: null }])
        forgetPlanLimits('c4')

        await restorePlanLimits(now)

        expect(readPlanLimits('c4')).toEqual({
            windows: [
                { kind: 'session', label: null, usedPercent: 20, resetsAt: null },
                { kind: 'weekly', label: null, usedPercent: 50, resetsAt: '2026-11-17T00:00:00.000Z' }
            ],
            capturedAt: '2026-11-11T09:00:00.000Z'
        })
        expect(readPlanLimits('c5')).toBeNull()
        expect(readPlanLimits('c3')?.windows[0]?.usedPercent).toBe(8)
    })
})
