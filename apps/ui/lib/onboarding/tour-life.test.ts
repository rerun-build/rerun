import { describe, expect, it } from 'vitest'

import { TOUR_AGENT_IDS } from '@rerun/ui/tour/board'
import { TOUR_LIFE_BEATS, TOUR_LIFE_START, TOUR_LIFE_STILL, type TourLifeStatus, tourLifeAt } from '@rerun/ui/tour/life'

const MIN_HOLD_MS: Record<TourLifeStatus, number> = {
    idle: 3_000,
    working: 5_000,
    waiting_human: 10_000,
}
const AGENT_FLOW: readonly TourLifeStatus[] = ['working', 'waiting_human', 'working', 'idle']
const PERIOD_MS = 94_000
const MAX_LIT = 3

const litCount = (statuses: Record<string, string>) => Object.values(statuses).filter(status => status !== 'idle').length

describe('TOUR_LIFE_BEATS', () => {
    it('only ever wakes an agent that stands on the board', () => {
        for (const beat of TOUR_LIFE_BEATS) expect(TOUR_AGENT_IDS).toContain(beat.agent)
        for (const agent of Object.keys(TOUR_LIFE_STILL)) expect(TOUR_AGENT_IDS).toContain(agent)
    })

    it('gives every agent one complete work, decision, resume, finish story', () => {
        for (const agent of TOUR_AGENT_IDS) {
            expect(TOUR_LIFE_BEATS.filter(beat => beat.agent === agent).map(beat => beat.status), agent).toEqual(AGENT_FLOW)
        }
    })

    it('changes one tile at a time over a 94 second loop', () => {
        const at: number[] = []
        let time = 0
        for (const beat of TOUR_LIFE_BEATS) {
            at.push(time)
            time += beat.hold
        }

        expect(new Set(at).size).toBe(at.length)
        expect(time).toBe(PERIOD_MS)
    })

    it('holds each status for its minimum duration, including across the loop', () => {
        const period = TOUR_LIFE_BEATS.reduce((total, beat) => total + beat.hold, 0)
        const changes = new Map<string, { at: number; status: TourLifeStatus }[]>()
        let time = 0
        for (const beat of TOUR_LIFE_BEATS) {
            changes.set(beat.agent, [...(changes.get(beat.agent) ?? []), { at: time, status: beat.status }])
            time += beat.hold
        }

        for (const [agent, events] of changes) {
            events.forEach((event, index) => {
                const next = index + 1 < events.length ? events[index + 1].at : events[0].at + period
                expect(next - event.at, `${agent} ${event.status}`).toBeGreaterThanOrEqual(MIN_HOLD_MS[event.status])
            })
        }

        expect(TOUR_LIFE_START).toBeGreaterThanOrEqual(MIN_HOLD_MS.idle)
    })

    it('never lights up more than a corner of the board', () => {
        const lit = TOUR_LIFE_BEATS.map((_, index) => litCount(tourLifeAt(index)))
        expect(Math.max(...lit)).toBeLessThanOrEqual(MAX_LIT)
    })

    it('ends the cycle on the board it starts from', () => {
        expect(litCount(tourLifeAt(TOUR_LIFE_BEATS.length - 1))).toBe(0)
    })

    it('folds the same frame on every turn of the loop', () => {
        expect(tourLifeAt(TOUR_LIFE_BEATS.length + 3)).toEqual(tourLifeAt(3))
    })
})
