import type { AgentStatus } from '@moldwright/ui/iso-grid'

import type { PlanBeats, PlanItem } from '@/components/foreman/widgets/plan-card'

export type PlanLifeStage = 'rest' | 'trigger' | 'working' | 'delivered'

export type PlanLifeBeat = { hold: number; stage: PlanLifeStage; status: AgentStatus; line: string | null }

const REST_MS = 2800

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
