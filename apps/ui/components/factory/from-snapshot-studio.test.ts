import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema, type FactorySnapshot } from '@moldwright/contracts'
import { sceneFromSnapshot } from './from-snapshot'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const NOW = Date.parse('2026-11-14T03:24:40Z')

const building = (coworker: string, copy: number): FactorySnapshot => {
    const s = factorySnapshotSchema.parse(JSON.parse(readFileSync(SAMPLE, 'utf8')))
    const job = { ...s.jobs[0], issue: 900, state: 'building' as const, coworker, copy, parent: null }
    return { ...s, jobs: [job] }
}
const podPath = (s: FactorySnapshot) => sceneFromSnapshot(s, NOW).pods.find(p => p.issue === 900)?.path

describe('a research or design job being built', () => {
    it('docks the researcher in Research & design', () => {
        expect(podPath(building('search', 1))).toEqual(['Delegator', 'search'])
    })

    it('docks the designer in Research & design', () => {
        expect(podPath(building('DIETER', 1))).toEqual(['Delegator', 'DIETER'])
    })

    it('puts a second researcher copy in the studio box', () => {
        const s = building('search', 2)
        expect(podPath(s)).toEqual(['Delegator', 'search-copy-900'])
        const tile = sceneFromSnapshot(s, NOW).tiles.find(t => t.id === 'search-copy-900')
        expect(tile?.containerId).toBe('studio')
    })

    it('keeps a builder on the build path', () => {
        expect(podPath(building('code', 1))).toEqual(['Delegator', 'code'])
    })
})
