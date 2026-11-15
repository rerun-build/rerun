import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factoryJobStateSchema, factorySnapshotSchema } from '@rerun/contracts'
import { JOB_GROUPS, JOB_STATE_VIEW, groupOf } from './factory-state'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = () => JSON.parse(readFileSync(SAMPLE, 'utf8'))

describe('superseded', () => {
    it('superseded is the last state of the contract and an ended state on screen', () => {
        expect(factoryJobStateSchema.options.at(-1)).toBe('superseded')
        expect(groupOf('superseded')).toBe('ended')
        expect(JOB_GROUPS.ended).toContain('superseded')
        expect(JOB_STATE_VIEW.superseded.dim).toBe(true)
    })

    it('is accepted on a job of the snapshot', () => {
        const s = sample()
        s.jobs[0].state = 'superseded'
        expect(factorySnapshotSchema.safeParse(s).success).toBe(true)
    })
})
