import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema } from '@rerun/contracts'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = () => JSON.parse(readFileSync(SAMPLE, 'utf8'))
const job = (snapshot: ReturnType<typeof sample>, issue: number) => snapshot.jobs.find((j: { issue: number }) => j.issue === issue)

describe('factory snapshot cacheRead', () => {
    it('accepts the old shape: no cacheRead on any run', () => {
        const s = sample()
        for (const j of s.jobs) for (const r of j.runs ?? []) delete r.cacheRead
        expect(factorySnapshotSchema.safeParse(s).success).toBe(true)
    })

    it('keeps cacheRead through parsing and the sample carries it on the runs of #331 and #335', () => {
        const parsed = factorySnapshotSchema.parse(sample())
        const runs = (issue: number) => parsed.jobs.find(j => j.issue === issue)!.runs!
        expect(runs(331)[0].cacheRead).toBe(900)
        expect(runs(335).map(r => r.cacheRead)).toEqual([1500, 600, 800])
        expect(runs(330)[0].cacheRead).toBeUndefined()
    })

    it('refuses a negative, a fractional or a non-number cacheRead', () => {
        for (const bad of [-1, 1.5, '900', null]) {
            const s = sample()
            job(s, 331).runs[0].cacheRead = bad
            expect(factorySnapshotSchema.safeParse(s).success).toBe(false)
        }
    })
})
