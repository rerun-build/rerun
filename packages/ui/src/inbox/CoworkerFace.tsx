'use client'

import { agentKindOfEngineId, agentKindPolicy } from '@rerun/contracts'
import type { ReactNode } from 'react'

import { Orb } from '../foreman/Orb'
import { AgentBuddy } from '../iso-grid/components/buddy/AgentBuddy'

// Who an update comes from, drawn as its kind is: a coworker's buddy, or the Chief of Staff's orb,
// whom the apps call `foreman`. `badge` sits on its corner, as on a buddy.
export function CoworkerFace({ agentId, size, badge }: { agentId: string; size: number; badge?: ReactNode }) {
    if (agentKindPolicy(agentKindOfEngineId(agentId)).look === 'buddy') return <AgentBuddy agentId={agentId} size={size} animated={false} facing="right" badge={badge} />
    return (
        <span className="relative flex shrink-0" style={{ width: size, height: size }}>
            <Orb size={size} paused facing="right" />
            {badge && <span className="absolute -bottom-1 -left-1 flex">{badge}</span>}
        </span>
    )
}
