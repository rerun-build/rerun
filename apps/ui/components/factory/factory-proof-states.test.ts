import { describe, expect, it } from 'vitest'
import { factoryJobStateSchema, type FactoryJob, type FactorySnapshot } from '@moldwright/contracts'
import { buildLedger, chipCounts } from './factory-ledger'
import { barModel } from './factory-metrics'
import { sceneFromSnapshot } from './from-snapshot'
import { JOB_GROUPS, JOB_STATE_VIEW, groupOf } from './factory-state'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const job = (issue: number, state: FactoryJob['state']): FactoryJob => ({
    issue, title: `T${issue}`, state, enteredAt: new Date(NOW - 60_000).toISOString(), pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: 1, dependsOn: [], reason: null,
})
const snapshot = (): FactorySnapshot => ({
    version: 1, madeAt: new Date(NOW).toISOString(), beat: 1, repo: 'o/r',
    jobs: [job(10, 'proof_wait'), job(11, 'proving'), job(12, 'checks')],
    epics: [{ issue: 1, title: 'Epic one', kind: 'feature' }], holds: [], pools: [],
    endedToday: { merged: 0, rejected: 0, blocked: 0, failed: 0, returned: 0 },
})
const zero = { queued: 0, building: 0, review: 0, checks: 0, merged: 0, runs: 0 }

describe('the proof states', () => {
    it('sit between checks and merged in the contract', () => {
        const options = factoryJobStateSchema.options
        expect(options.slice(options.indexOf('checks'), options.indexOf('merged') + 1)).toEqual(['checks', 'proof_wait', 'proving', 'merged'])
    })

    it('give every state a view and exactly one group, the proof states with the active ones', () => {
        for (const state of factoryJobStateSchema.options) {
            expect(JOB_STATE_VIEW[state], state).toBeDefined()
            const groups = Object.values(JOB_GROUPS).filter((g) => g.includes(state))
            expect(groups, state).toHaveLength(1)
        }
        expect(groupOf('proof_wait')).toBe('active')
        expect(groupOf('proving')).toBe('active')
    })

    it('count in the ledger chips: proving runs, proof_wait waits', () => {
        const chips = chipCounts(buildLedger(snapshot()), NOW)
        expect(chips.running).toBe(2)
        expect(chips.waiting).toBe(1)
    })

    it('count as review in the bar', () => {
        const { values } = barModel({ snapshot: snapshot(), counts: zero, held: false, now: NOW, start: NOW })
        expect(values.review.text).toBe('2')
        expect(values.checks.text).toBe('1')
    })

    it('draw at the review gate on the floor: proof_wait queued, proving working', () => {
        const f = sceneFromSnapshot(snapshot(), NOW)
        expect(f.pods.find((p) => p.issue === 10)).toMatchObject({ band: 'review', state: 'queued' })
        expect(f.pods.find((p) => p.issue === 11)).toMatchObject({ band: 'review', state: 'working' })
        expect(f.counts).toMatchObject({ review: 2, checks: 1 })
    })
})
