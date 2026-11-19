import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema, type FactorySnapshot } from '@moldwright/contracts'
import { loaderView } from './factory-loader'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = (): FactorySnapshot => factorySnapshotSchema.parse(JSON.parse(readFileSync(SAMPLE, 'utf8')))
const MADE = Date.parse('2026-11-14T03:24:30Z')

describe('loaderView', () => {
    it('says the Loader answers when the picture is at most two beats old', () => {
        const s = sample()
        const a = loaderView(s, MADE + 60_000).alive
        expect(a).toMatchObject({ beat: 412, lastBeatAt: s.madeAt, answering: true })
        expect(loaderView(s, MADE + 60_001).alive.answering).toBe(false)
    })

    it('lists what each waiting job waits on', () => {
        const v = loaderView(sample(), MADE)
        expect(v.waiting).toEqual([
            { issue: 332, title: 'Heartbeat endpoint', waitsOn: [{ issue: 331, state: 'reviewing' }], reason: 'waits on #331' },
        ])
        const s = sample()
        s.jobs.find(j => j.issue === 332)!.dependsOn = [999]
        expect(loaderView(s, MADE).waiting[0]!.waitsOn).toEqual([{ issue: 999, state: null }])
    })

    it('lists queued jobs in snapshot order with a position', () => {
        const s = sample()
        s.jobs.find(j => j.issue === 334)!.state = 'queued'
        s.jobs.find(j => j.issue === 330)!.state = 'queued'
        expect(loaderView(s, MADE).queued).toEqual([
            { position: 1, issue: 330, title: 'Fab floor' },
            { position: 2, issue: 334, title: 'Glass copies' },
        ])
    })

    it('shows a hold with its kind and the time left, and drops one that ended', () => {
        expect(loaderView(sample(), MADE + 10_000).holds).toEqual([{ kind: 'sign-in renewal', leftMs: 600_000 }])
        expect(loaderView(sample(), Date.parse('2026-11-14T03:34:40Z') + 1).holds).toEqual([])
    })

    it('sums the pools', () => {
        const p = loaderView(sample(), MADE).pools
        expect(p.map(x => [x.type, x.allowed, x.out])).toEqual([
            ['coder', 7, 2],
            ['reviewer', 4, 1],
            ['researcher', 3, 0],
            ['designer', 1, 0],
        ])
        expect(p[0]!.coworkers[0]).toEqual({ name: 'code', runs: 6, out: 2 })
    })

    it('passes the ended-today counts', () => {
        const s = sample()
        const v = loaderView(s, MADE)
        expect(v.ended).toEqual(s.endedToday)
        expect(v.endedTotal).toBe(2)
    })
})
