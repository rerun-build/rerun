export type TourTeammate = { id: string; name: string; role: string; color: string; home: string; photo: string }

const portrait = (id: string) => `/onboarding/tour/team/${id}.webp`

export const TOUR_TEAMMATES: readonly TourTeammate[] = [
    { id: 'theo', name: 'Théo', role: 'Head of growth', color: 'hsl(210 80% 52%)', home: 'tour-social', photo: portrait('theo') },
    { id: 'sofia', name: 'Sofia', role: 'Account executive', color: 'hsl(340 68% 52%)', home: 'tour-research', photo: portrait('sofia') },
    { id: 'noah', name: 'Noah', role: 'Operations specialist', color: 'hsl(150 55% 38%)', home: 'tour-docs', photo: portrait('noah') },
]

export const TOUR_TEAM_AT_START: readonly string[] = ['theo', 'sofia']

export const TOUR_CURSOR_OFFSETS: Record<string, { x: number; y: number }> = {
    theo: { x: 52, y: -8 },
    sofia: { x: 46, y: 12 },
    noah: { x: 34, y: 26 },
}

export type TourTeamBeat = {
    hold: number
    join?: string
    leave?: string
    move?: { who: string; to: string }
    handoff?: string
}

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

export const TOUR_TEAM_STILL_BEAT = 7

export type TourTeamState = {
    present: readonly string[]
    at: Record<string, string>
    handoff?: string
}

const HOMES: Record<string, string> = Object.fromEntries(TOUR_TEAMMATES.map(mate => [mate.id, mate.home]))

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
