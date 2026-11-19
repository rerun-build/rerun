import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema, type FactorySnapshot } from '@moldwright/contracts'
import { getFactorySnapshot, putFactorySnapshot } from './snapshot-store'

const SAMPLE = path.resolve(import.meta.dirname, '../../../../packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = (madeAt: string, beat = 1): FactorySnapshot => ({ ...factorySnapshotSchema.parse(JSON.parse(readFileSync(SAMPLE, 'utf8'))), madeAt, beat })

describe('factory snapshot store', () => {
    it('keeps the newest picture per workspace, apart from every other workspace', () => {
        expect(putFactorySnapshot(101, sample('2026-11-14T03:00:00Z'), 1)).toBe(true)
        expect(putFactorySnapshot(102, sample('2026-11-14T03:05:00Z'), 2)).toBe(true)
        expect(getFactorySnapshot(101)?.snapshot.madeAt).toBe('2026-11-14T03:00:00Z')
        expect(getFactorySnapshot(102)?.receivedAt).toBe(2)
        expect(getFactorySnapshot(103)).toBeNull()
    })

    it('ignores a picture older than the one it holds, and takes a newer one after a restart of the delegator', () => {
        putFactorySnapshot(201, sample('2026-11-14T03:10:00Z', 500))
        expect(putFactorySnapshot(201, sample('2026-11-14T03:09:30Z', 501))).toBe(false)
        expect(getFactorySnapshot(201)?.snapshot.beat).toBe(500)
        expect(putFactorySnapshot(201, sample('2026-11-14T03:11:00Z', 0))).toBe(true)
        expect(getFactorySnapshot(201)?.snapshot.beat).toBe(0)
    })
})
