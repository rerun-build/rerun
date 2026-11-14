import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import type { BuddyMood } from '@/components/buddy/look'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import type { Coworker, CoworkerStatus } from '@/mocks/data'

const MOOD: Record<CoworkerStatus, BuddyMood> = { idle: 'idle', working: 'working', error: 'error', waiting_human: 'waiting', offline: 'asleep' }

export function moodOf(status: CoworkerStatus): BuddyMood {
    return MOOD[status]
}

type CoworkerAvatarProps = {
    coworker: Pick<Coworker, 'id' | 'kind' | 'status'>
    size: number
    animated?: boolean
    facing?: 'left' | 'right'
}

export function CoworkerAvatar({ coworker, size, animated = true, facing = 'left' }: CoworkerAvatarProps) {
    if (coworker.kind === 'foreman') return <ForemanOrb size={size * 0.86} state={coworker.status === 'working' ? 'thinking' : 'idle'} facing={facing} animated={animated} style={{ margin: size * 0.07 }} />
    return <AgentBuddy agentId={coworker.id} size={size} mood={moodOf(coworker.status)} animated={animated} facing={facing} />
}
