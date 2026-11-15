import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FACTORY_SNAPSHOT_MAX_BYTES, factorySnapshotSchema } from '@rerun/contracts'

const SAMPLE = path.resolve(import.meta.dirname, '../../../../packages/contracts/fixtures/factory-snapshot.sample.json')
const base = () => JSON.parse(readFileSync(SAMPLE, 'utf8'))
const run = { id: '39311ebf-8324-42a4-8ab4-770acd1653f2', name: 'Boss', runId: 'run-b1', startedAt: '2026-11-15T02:00:00Z', steps: 12 }
const entry = (over: object = {}) => ({ parent: 450, title: 'Floor', coworkers: [run], children: 3, filed: 2, ...over })
const withPlanning = (planning: unknown) => ({ ...base(), planning })
const accepted = (planning: unknown) => factorySnapshotSchema.safeParse(withPlanning(planning)).success

describe('the snapshot contract carries planning', () => {
    it('accepts the old shape: no planning key', () => {
        expect(factorySnapshotSchema.safeParse(base()).success).toBe(true)
    })

    it('accepts an empty list, an entry with no coworkers and a coworker with null steps', () => {
        expect(accepted([])).toBe(true)
        expect(accepted([entry({ coworkers: [] })])).toBe(true)
        expect(accepted([entry({ coworkers: [{ ...run, steps: null }] })])).toBe(true)
    })

    it('keeps the entry as it was written', () => {
        const parsed = factorySnapshotSchema.parse(withPlanning([entry()]))
        expect(parsed.planning).toEqual([entry()])
    })

    it('accepts each limit and refuses one past it', () => {
        const long = (n: number) => 'x'.repeat(n)
        const cases: [string, (n: number) => unknown, number][] = [
            ['entries', n => Array.from({ length: n }, () => entry()), 5],
            ['coworkers', n => [entry({ coworkers: Array.from({ length: n }, () => run) })], 8],
            ['title', n => [entry({ title: long(n) })], 256],
            ['id', n => [entry({ coworkers: [{ ...run, id: long(n) }] })], 64],
            ['name', n => [entry({ coworkers: [{ ...run, name: long(n) }] })], 64],
            ['runId', n => [entry({ coworkers: [{ ...run, runId: long(n) }] })], 64],
        ]
        for (const [name, make, limit] of cases) {
            expect(accepted(make(limit)), `${name} at ${limit}`).toBe(true)
            expect(accepted(make(limit + 1)), `${name} at ${limit + 1}`).toBe(false)
        }
    })

    it('refuses a bad value in an entry or a coworker', () => {
        for (const bad of [{ parent: 0 }, { parent: 1.5 }, { filed: -1 }, { children: -1 }, { title: 4 }, { children: 'three' }]) expect(accepted([entry(bad)]), JSON.stringify(bad)).toBe(false)
        for (const bad of [{ startedAt: 'yesterday' }, { startedAt: 1794000000 }, { steps: -1 }, { steps: 1.5 }, { runId: null }]) expect(accepted([entry({ coworkers: [{ ...run, ...bad }] })]), JSON.stringify(bad)).toBe(false)
    })

    it('refuses an unknown key in an entry or a coworker', () => {
        expect(accepted([{ ...entry(), extra: 1 }])).toBe(false)
        expect(accepted([entry({ coworkers: [{ ...run, extra: 1 }] })])).toBe(false)
    })

    it('stays under the byte limit with five entries of eight coworkers', () => {
        const full = Array.from({ length: 5 }, (_, i) => entry({ parent: 400 + i, coworkers: Array.from({ length: 8 }, () => run) }))
        expect(Buffer.byteLength(JSON.stringify(withPlanning(full)))).toBeLessThan(FACTORY_SNAPSHOT_MAX_BYTES)
    })
})
