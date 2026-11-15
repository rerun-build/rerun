export type TourLifeStatus = 'working' | 'waiting_human' | 'idle'

export type TourLifeBeat = { agent: string; status: TourLifeStatus; hold: number }

export const TOUR_LIFE_BEATS: readonly TourLifeBeat[] = [
    { agent: 'tour-writer', status: 'working', hold: 6000 },
    { agent: 'tour-writer', status: 'waiting_human', hold: 7000 },
    { agent: 'tour-research', status: 'working', hold: 3000 },
    { agent: 'tour-writer', status: 'working', hold: 3000 },
    { agent: 'tour-research', status: 'waiting_human', hold: 3000 },
    { agent: 'tour-watch', status: 'working', hold: 2000 },
    { agent: 'tour-writer', status: 'idle', hold: 4000 },
    { agent: 'tour-watch', status: 'waiting_human', hold: 2000 },
    { agent: 'tour-research', status: 'working', hold: 4000 },
    { agent: 'tour-docs', status: 'working', hold: 2000 },
    { agent: 'tour-research', status: 'idle', hold: 2000 },
    { agent: 'tour-watch', status: 'working', hold: 3000 },
    { agent: 'tour-docs', status: 'waiting_human', hold: 3000 },
    { agent: 'tour-social', status: 'working', hold: 2000 },
    { agent: 'tour-watch', status: 'idle', hold: 3000 },
    { agent: 'tour-social', status: 'waiting_human', hold: 2000 },
    { agent: 'tour-docs', status: 'working', hold: 3000 },
    { agent: 'tour-invoices', status: 'working', hold: 3000 },
    { agent: 'tour-docs', status: 'idle', hold: 3000 },
    { agent: 'tour-social', status: 'working', hold: 2000 },
    { agent: 'tour-invoices', status: 'waiting_human', hold: 2000 },
    { agent: 'tour-desk', status: 'working', hold: 4000 },
    { agent: 'tour-social', status: 'idle', hold: 2000 },
    { agent: 'tour-desk', status: 'waiting_human', hold: 3000 },
    { agent: 'tour-invoices', status: 'working', hold: 5000 },
    { agent: 'tour-invoices', status: 'idle', hold: 3000 },
    { agent: 'tour-desk', status: 'working', hold: 7000 },
    { agent: 'tour-desk', status: 'idle', hold: 6000 },
]

export const TOUR_LIFE_START = 3200

export function tourLifeAt(index: number): Record<string, TourLifeStatus> {
    const statuses: Record<string, TourLifeStatus> = {}
    for (let i = 0; i <= index % TOUR_LIFE_BEATS.length; i++) {
        const beat = TOUR_LIFE_BEATS[i]
        statuses[beat.agent] = beat.status
    }
    return statuses
}

export const TOUR_LIFE_STILL: Record<string, TourLifeStatus> = {
    'tour-writer': 'working',
    'tour-research': 'waiting_human',
    'tour-docs': 'working',
}
