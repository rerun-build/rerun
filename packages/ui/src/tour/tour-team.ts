// The teammates who come and work on the board on the last slide of the tour, and the flow they play
// out: a draft written, a discount escalated, the invoices filed, the post scheduled. The people are
// invented, and each one wears a face: the slide has to read as colleagues rather than as three
// coloured arrows, which is the one thing a name alone never manages at that size.
//
// The portraits are committed under public/onboarding/tour/team/ by
// scripts/seed-onboarding-tour-board.ts, never fetched at runtime: a face that pops in a beat after
// its cursor reads as a bug, and the tour has to hold up offline.
//
// Everything here is a constant, like tour-board.ts: the slide renders on the server first, so a
// position or a beat drawn at random would move between the server HTML and the first client paint.

export type TourTeammate = { id: string; name: string; roleKey: 'headOfGrowth' | 'accountExecutive' | 'operationsSpecialist'; color: string; home: string; photo: string }

const portrait = (id: string) => `/onboarding/tour/team/${id}.webp`

export const TOUR_TEAMMATES: readonly TourTeammate[] = [
    { id: 'theo', name: 'Théo', roleKey: 'headOfGrowth', color: 'hsl(210 80% 52%)', home: 'tour-social', photo: portrait('theo') },
    { id: 'sofia', name: 'Sofia', roleKey: 'accountExecutive', color: 'hsl(340 68% 52%)', home: 'tour-research', photo: portrait('sofia') },
    { id: 'noah', name: 'Noah', roleKey: 'operationsSpecialist', color: 'hsl(150 55% 38%)', home: 'tour-docs', photo: portrait('noah') },
]

// Two people are already there when the loop starts over, never one: the slide has to read as a
// shared Box on its very first frame, not as somebody waiting for company.
export const TOUR_TEAM_AT_START: readonly string[] = ['theo', 'sofia']

// Where a cursor stands relative to the centre of the agent tile it is on, in world units. All three
// stand off the **east** side of the block: the name pill always grows to the right of the arrow, so
// a cursor parked on the middle of a tile lays its own name over the agent's. Fixed per person rather
// than derived, so two of them never land on the same pixel or swap sides mid travel.
export const TOUR_CURSOR_OFFSETS: Record<string, { x: number; y: number }> = {
    theo: { x: 52, y: -8 },
    sofia: { x: 46, y: 12 },
    noah: { x: 34, y: 26 },
}

// One beat of the flow: someone joins, walks to an agent, or leaves. The board says nothing back in
// words, the work it is doing already shows in the tiles' own statuses.
export type TourTeamBeat = {
    hold: number
    join?: string
    leave?: string
    move?: { who: string; to: string }
    // A hand-off between two agents, lit for the length of this beat only. It gets its own beat once
    // the teammate has arrived, so the beam can be read as a transfer instead of a travel effect.
    handoff?: string
}

// Roughly twenty-one seconds end to end, then it starts again from a half empty board. The first
// hold outlasts the dialog's slide in, so nobody walks off while the words are still moving. Each
// inter-Box hand-off gets five seconds after arrival: long enough to carry the same weight as a
// `working` state, short enough not to turn into permanent plumbing.
export const TOUR_TEAM_BEATS: readonly TourTeamBeat[] = [
    { hold: 1000 },
    { hold: 900, move: { who: 'theo', to: 'tour-writer' } },
    { hold: 1800 },
    { hold: 900, move: { who: 'sofia', to: 'tour-desk' } },
    { hold: 5000, handoff: 'handoff-marketing-sales' },
    { hold: 800, join: 'noah' },
    { hold: 900, move: { who: 'noah', to: 'tour-docs' } },
    { hold: 5000, handoff: 'handoff-marketing-ops' },
    { hold: 900, move: { who: 'theo', to: 'tour-social' } },
    { hold: 1700 },
    { hold: 900, leave: 'theo' },
    { hold: 1100, leave: 'noah', move: { who: 'sofia', to: 'tour-research' } },
]

// The frame reduced motion freezes on: everyone in, each on their own agent.
export const TOUR_TEAM_STILL_BEAT = 7

export type TourTeamState = {
    present: readonly string[]
    at: Record<string, string>
    handoff?: string
}

const HOMES: Record<string, string> = Object.fromEntries(TOUR_TEAMMATES.map(mate => [mate.id, mate.home]))

// Presence and positions are folded from the top of the loop rather than held in state: the beat
// index is the only thing that moves, so the flow cannot drift out of sync with itself, and wrapping
// back to zero resets the scene for free.
export function tourTeamStateAt(index: number): TourTeamState {
    const present = [...TOUR_TEAM_AT_START]
    const at = { ...HOMES }

    for (let i = 0; i <= index; i++) {
        const beat = TOUR_TEAM_BEATS[i]
        if (beat.join && !present.includes(beat.join)) present.push(beat.join)
        if (beat.leave) {
            const leaving = present.indexOf(beat.leave)
            if (leaving >= 0) present.splice(leaving, 1)
        }
        if (beat.move) at[beat.move.who] = beat.move.to
    }

    const current = TOUR_TEAM_BEATS[index]
    return { present, at, handoff: current.handoff }
}
