import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema, type FactorySnapshot } from '@rerun/contracts'
import { TileBuddy, buddyColor, type Tile } from '@rerun/ui/iso-grid'
import { sceneFromSnapshot } from './from-snapshot'
import { BOSS, BOSS_ID, PLANNER_CELLS, PLAN_TANK } from './factory-scene'

const SAMPLE = path.resolve(import.meta.dirname, '../../../../packages/contracts/fixtures/factory-snapshot.sample.json')
const NOW = Date.parse('2026-11-14T03:24:40Z')
const SHAPER_ID = '1b325848-c3fd-4e6f-9ad7-43f3adac08b6'
const run = (id: string, name: string) => ({ id, name, runId: `run-${name}`, startedAt: '2026-11-15T02:00:00Z', steps: 3 })
const plan = (parent: number | null, coworkers: ReturnType<typeof run>[], extra: object = {}) => ({ parent, title: `Cut ${parent}`, coworkers, children: 3, filed: 2, ...extra })
const snap = (planning?: unknown[]): FactorySnapshot => factorySnapshotSchema.parse({ ...JSON.parse(readFileSync(SAMPLE, 'utf8')), ...(planning ? { planning } : {}) })
const tile = (f: ReturnType<typeof sceneFromSnapshot>, id: string) => f.tiles.find(t => t.id === id)
const style = (t: Tile | undefined) => t?.style as { glow?: string; buddy?: { mood?: string; ownColor?: boolean; color?: string } }
const markup = (t: Tile) => renderToStaticMarkup(createElement(TileBuddy, { id: t.id, style: t.style as never, width: 120, height: 120, floorOffset: 0 }))

describe('the planning room from a snapshot', () => {
    it('shows Boss idle in its own colour and no tank when nothing is planned', () => {
        for (const s of [snap(), snap([])]) {
            const f = sceneFromSnapshot(s, NOW)
            expect(tile(f, 'Boss')).toMatchObject({ position: BOSS, containerId: 'planning', span: 2 })
            expect(style(tile(f, 'Boss'))).toMatchObject({ glow: 'var(--iso-tile-idle-glow)', buddy: { color: buddyColor(BOSS_ID, {}) } })
            expect(style(tile(f, 'Boss')).buddy?.mood).toBeUndefined()
            expect(f.tiles.filter(t => t.id.startsWith('plan'))).toEqual([])
            expect(f.plans).toEqual([])
            expect(f.links.filter(l => l.source.startsWith('plan'))).toEqual([])
        }
    })

    it('shows Boss working, taller, in its own colour while Boss runs, with the parent as a tank at its desk', () => {
        const f = sceneFromSnapshot(snap([plan(449, [run(BOSS_ID, 'Boss')])]), NOW)
        expect(style(tile(f, 'Boss'))).toMatchObject({ glow: `color-mix(in srgb, ${buddyColor(BOSS_ID, {})} 60%, transparent)`, buddy: { mood: 'working', ownColor: true, color: buddyColor(BOSS_ID, {}) } })
        expect(markup(tile(f, 'Boss')!)).toContain('data-buddy-stretched')
        expect(tile(f, 'plan-449')).toMatchObject({ position: PLAN_TANK, containerId: 'planning', span: 2, ariaLabel: 'Planning #449 Cut 449: 2 of 3 filed' })
        expect(f.plans).toEqual([{ parent: 449, title: 'Cut 449', children: 3, filed: 2 }])
        expect(f.links.find(l => l.source === 'plan-449')).toMatchObject({ target: 'Delegator', variant: 'belt', still: true, chevrons: true })
    })

    it('shows another planner beside Boss in its own look only while it runs', () => {
        const f = sceneFromSnapshot(snap([plan(449, [run(SHAPER_ID, 'Scope Shaper')])]), NOW)
        expect(style(tile(f, 'Boss')).buddy?.mood).toBeUndefined()
        const t = tile(f, `planner-${SHAPER_ID.slice(0, 8)}`)
        expect(t).toMatchObject({ position: PLANNER_CELLS[0], containerId: 'planning', ariaLabel: 'Scope Shaper' })
        expect(style(t)).toMatchObject({ buddy: { mood: 'working', ownColor: true, color: buddyColor(SHAPER_ID, {}) } })
        expect(f.tiles.filter(x => x.id.startsWith('planner-'))).toHaveLength(1)
    })

    it('draws one tank for the newest parent and each coworker once', () => {
        const f = sceneFromSnapshot(snap([plan(449, [run(BOSS_ID, 'Boss')]), plan(452, [run(BOSS_ID, 'Boss'), run(BOSS_ID, 'Boss')], { filed: 0 })]), NOW)
        expect(f.tiles.filter(t => t.id.startsWith('plan-'))).toHaveLength(1)
        expect(f.plans).toEqual([{ parent: 452, title: 'Cut 452', children: 3, filed: 0 }])
        expect(f.tiles.filter(t => t.id === 'Boss' || t.id.startsWith('planner-'))).toHaveLength(1)
    })

    it('keeps the tank for a labelled parent when no planner runs', () => {
        const f = sceneFromSnapshot(snap([plan(449, [])]), NOW)
        expect(style(tile(f, 'Boss')).buddy?.mood).toBeUndefined()
        expect(tile(f, 'plan-449')).toBeTruthy()
    })

    it('leaves the pods, cabinets and counts of the sample as they were', () => {
        const a = sceneFromSnapshot(snap(), NOW)
        const b = sceneFromSnapshot(snap([plan(449, [run(BOSS_ID, 'Boss')])]), NOW)
        expect(b.pods).toEqual(a.pods)
        expect(b.cabinets).toEqual(a.cabinets)
        expect(b.counts).toEqual(a.counts)
    })

    it('shows Boss and another planner working when the only entry has no parent, with no tank', () => {
        const f = sceneFromSnapshot(snap([plan(null, [run(BOSS_ID, 'Boss'), run(SHAPER_ID, 'Scope Shaper')], { title: '', children: 0, filed: 0 })]), NOW)
        expect(style(tile(f, 'Boss')).buddy?.mood).toBe('working')
        expect(style(tile(f, `planner-${SHAPER_ID.slice(0, 8)}`)).buddy?.mood).toBe('working')
        expect(f.tiles.filter(t => t.id.startsWith('plan-'))).toEqual([])
        expect(f.plans).toEqual([])
        expect(f.links.filter(l => l.source.startsWith('plan'))).toEqual([])
    })

    it('keeps Boss idle and no tank for an entry with no parent and no running planner', () => {
        const f = sceneFromSnapshot(snap([plan(null, [], { title: '', children: 0, filed: 0 })]), NOW)
        expect(style(tile(f, 'Boss')).buddy?.mood).toBeUndefined()
        expect(f.tiles.filter(t => t.id.startsWith('plan-'))).toEqual([])
        expect(f.plans).toEqual([])
    })

    it('keeps the tank of the newest entry with a parent when a later entry has none', () => {
        const f = sceneFromSnapshot(snap([plan(449, []), plan(null, [run(BOSS_ID, 'Boss')], { title: '', children: 0, filed: 0 })]), NOW)
        expect(style(tile(f, 'Boss')).buddy?.mood).toBe('working')
        expect(f.tiles.filter(t => t.id.startsWith('plan-')).map(t => t.id)).toEqual(['plan-449'])
        expect(f.plans).toEqual([{ parent: 449, title: 'Cut 449', children: 3, filed: 2 }])
    })
})
