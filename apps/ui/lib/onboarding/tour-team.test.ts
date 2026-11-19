import { ENGLISH_MESSAGES } from '@rerun/i18n/messages/en'
import { describe, expect, it } from 'vitest'

import { TOUR_AGENT_IDS, TOUR_HANDOFFS } from '@rerun/ui/tour/board'
import { TOUR_TEAM_BEATS, TOUR_TEAM_STILL_BEAT, TOUR_TEAMMATES, tourTeamStateAt } from '@rerun/ui/tour/team'

const HANDOFF_HOLD_MS = 5_000

describe('TOUR_TEAM_BEATS', () => {
    it('gives every teammate the role shown under their name', () => {
        expect(TOUR_TEAMMATES.map(({ name, roleKey }) => [name, ENGLISH_MESSAGES.kit.tour.roles[roleKey]])).toEqual([
            ['Théo', 'Head of growth'],
            ['Sofia', 'Account executive'],
            ['Noah', 'Operations specialist'],
        ])
    })

    it('only moves known teammates between known agents', () => {
        const teammates = new Set(TOUR_TEAMMATES.map(mate => mate.id))
        for (const beat of TOUR_TEAM_BEATS) {
            if (beat.join) expect(teammates.has(beat.join), `unknown join ${beat.join}`).toBe(true)
            if (beat.leave) expect(teammates.has(beat.leave), `unknown leave ${beat.leave}`).toBe(true)
            if (beat.move) {
                expect(teammates.has(beat.move.who), `unknown teammate ${beat.move.who}`).toBe(true)
                expect(TOUR_AGENT_IDS, `unknown agent ${beat.move.to}`).toContain(beat.move.to)
            }
        }
    })

    it('freezes reduced motion with the whole team present', () => {
        expect([...tourTeamStateAt(TOUR_TEAM_STILL_BEAT).present].sort()).toEqual(TOUR_TEAMMATES.map(mate => mate.id).sort())
    })

    it('holds every inter-Box hand-off for five seconds after the teammate arrives', () => {
        const handoffBeats = TOUR_TEAM_BEATS.flatMap((beat, index) => (beat.handoff ? [{ beat, index }] : []))

        expect(handoffBeats.map(({ beat }) => beat.handoff).sort()).toEqual(TOUR_HANDOFFS.map(handoff => handoff.id).sort())

        for (const { beat, index } of handoffBeats) {
            expect(TOUR_TEAM_BEATS[index - 1]?.move, beat.handoff).toBeDefined()
            expect(beat.move, beat.handoff).toBeUndefined()
            expect(beat.hold, beat.handoff).toBeGreaterThanOrEqual(HANDOFF_HOLD_MS)
            expect(tourTeamStateAt(index).handoff).toBe(beat.handoff)
            expect(tourTeamStateAt(index + 1).handoff).toBeUndefined()
        }
    })
})
