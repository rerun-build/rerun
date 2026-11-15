import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TileBuddy, buddyColor, type Tile } from '@rerun/ui/iso-grid'
import { BOSS, BOSS_ID, LOOP_MS, PLANNER_CELLS, PLAN_TANK, STATUS_COLOR, factoryScene } from './factory-scene'

const at = (t: number) => factoryScene(t, 0)
const tile = (t: number, id: string) => at(t).tiles.find(x => x.id === id)
const style = (x: Tile | undefined) => x?.style as { glow?: string; buddy?: { mood?: string; ownColor?: boolean; color?: string } }
const rides = (t: number) => at(t).pods.filter(p => p.path[0] === 'plan-321')
const belt = (t: number) => at(t).links.find(l => l.source === 'plan-321' && l.target === 'Delegator')
const markup = (x: Tile) => renderToStaticMarkup(createElement(TileBuddy, { id: x.id, style: x.style as never, width: 120, height: 120, floorOffset: 0 }))
const overlap = (a: Tile, b: Tile) => a.position.col < b.position.col + (b.span ?? 2) && b.position.col < a.position.col + (a.span ?? 2) && a.position.row < b.position.row + (b.span ?? 2) && b.position.row < a.position.row + (a.span ?? 2)

describe('the planning room of the sample loop', () => {
    it('has a Planning box above the Loader and Boss standing in it', () => {
        const box = at(0).containers.find(c => c.id === 'planning')
        expect(box).toMatchObject({ label: 'Planning', col_start: 0, row_start: 0, col_end: 10, row_end: 5 })
        expect(tile(0, 'Boss')).toMatchObject({ position: BOSS, containerId: 'planning', span: 2 })
        expect(BOSS).toEqual({ col: 1, row: 1 })
        expect(PLAN_TANK).toEqual({ col: 5, row: 1 })
        expect(PLANNER_CELLS).toEqual([{ col: 8, row: 1 }, { col: 8, row: 3 }])
    })

    it('shows Boss idle and no tank before and after the planning pass', () => {
        for (const t of [0, 10_000, 33_000, 47_500, 70_000]) {
            expect(style(tile(t, 'Boss')).buddy?.mood, `${t}`).toBeUndefined()
            expect(style(tile(t, 'Boss')).glow).toBe('var(--iso-tile-idle-glow)')
            expect(tile(t, 'plan-321')).toBeUndefined()
            expect(tile(t, 'Scope Shaper')).toBeUndefined()
            expect(at(t).plans).toEqual([])
            expect(belt(t)).toBeUndefined()
            expect(rides(t)).toEqual([])
        }
    })

    it('shows Boss working in its own colour, taller, with Scope Shaper and the tank, during the pass', () => {
        const boss = tile(39_000, 'Boss')!
        expect(style(boss).buddy).toMatchObject({ mood: 'working', ownColor: true, color: buddyColor(BOSS_ID, {}) })
        expect(markup(boss)).toContain('data-buddy-stretched')
        expect(tile(39_000, 'Scope Shaper')).toMatchObject({ position: PLANNER_CELLS[0], containerId: 'planning' })
        expect(style(tile(39_000, 'Scope Shaper')).buddy?.mood).toBe('working')
        expect(tile(39_000, 'plan-321')).toMatchObject({ position: PLAN_TANK, containerId: 'planning' })
        expect(at(39_000).plans).toEqual([{ parent: 321, title: 'Polish', children: 3, filed: 0 }])
    })

    it('files one child at 40 s, 42.5 s and 45 s and sends each to the Loader once', () => {
        expect(at(39_900).plans?.[0]?.filed).toBe(0)
        expect(at(40_000).plans?.[0]?.filed).toBe(1)
        expect(at(42_500).plans?.[0]?.filed).toBe(2)
        expect(at(45_000).plans?.[0]?.filed).toBe(3)
        expect(rides(40_900)).toHaveLength(1)
        expect(rides(40_900)[0]).toMatchObject({ path: ['plan-321', 'Delegator'], state: 'working', band: 'build', level: 0 })
        expect(rides(40_000)[0].travel).toBe(0)
        expect(rides(41_700)[0].travel).toBeGreaterThan(0.9)
        expect(rides(41_900)).toEqual([])
        expect(rides(44_500)).toEqual([])
        expect(rides(45_900)).toHaveLength(1)
        expect(rides(46_700)).toHaveLength(1)
        expect(rides(46_900)).toEqual([])
        expect(rides(47_000)).toEqual([])
    })

    it('moves the belt only while a sphere rides it', () => {
        expect(belt(36_000)).toMatchObject({ variant: 'belt', still: true })
        expect(belt(40_900)).toMatchObject({ variant: 'belt', still: false, color: STATUS_COLOR.build })
        expect(belt(44_500)).toMatchObject({ still: true })
    })

    it('keeps every tile of the pass inside the Planning box and off the others', () => {
        for (let t = 0; t < LOOP_MS; t += 500) {
            const tiles = at(t).tiles
            expect(new Set(tiles.map(x => x.id)).size).toBe(tiles.length)
            for (const x of tiles.filter(y => y.containerId === 'planning')) {
                expect(x.position.col).toBeGreaterThanOrEqual(0)
                expect(x.position.col + 1).toBeLessThanOrEqual(10)
                expect(x.position.row + 1).toBeLessThanOrEqual(5)
            }
            for (const a of tiles) for (const b of tiles) if (a.id < b.id && !a.id.includes('copy') && !b.id.includes('copy')) expect(overlap(a, b), `${a.id} ${b.id} ${t}`).toBe(false)
        }
    })
})
