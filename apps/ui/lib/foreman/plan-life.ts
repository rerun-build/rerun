import type { AgentStatus } from '@rerun/ui/iso-grid'

import type { PlanBeats, PlanItem } from '@/components/foreman/widgets/plan-card'

// The day the agent plays on its card: something sets it off, it works, it hands over, it rests.
// A written score and never a draw, one thing moving at a time, and a loop that closes on the same
// idle tile it opens on so the seam does not show.
export type PlanLifeStage = 'rest' | 'trigger' | 'working' | 'delivered'

export type PlanLifeBeat = { hold: number; stage: PlanLifeStage; status: AgentStatus; line: string | null }

// The first hold covers the entrance too: the Box draws for 0.9s and the tile falls for 1s after it,
// and a tile that changed colour mid-fall would snap.
const REST_MS = 2800

// A model that left the day out still wrote what sets the agent off, which is enough to play one.
// With neither, a template or a card from an older transcript, there is no day to play.
// `lines` are the two the screen writes itself, in the reader's language.
export function planLifeScript(item: Pick<PlanItem, 'beats' | 'when'>, lines: Pick<PlanBeats, 'working' | 'delivered'> = { working: 'Working on it', delivered: 'Handed over to you' }): PlanBeats | null {
    if (item.beats) return item.beats
    const trigger = item.when.trim()
    return trigger ? { trigger, ...lines } : null
}

export function planLifeBeats({ trigger, working, delivered }: PlanBeats): PlanLifeBeat[] {
    return [
        { hold: REST_MS, stage: 'rest', status: 'idle', line: null },
        { hold: 3200, stage: 'trigger', status: 'idle', line: trigger },
        { hold: 4600, stage: 'working', status: 'working', line: working },
        { hold: 4200, stage: 'delivered', status: 'idle', line: delivered },
    ]
}

export function planLifeAt(beats: readonly PlanLifeBeat[], tick: number): PlanLifeBeat {
    return beats[tick % beats.length]
}
