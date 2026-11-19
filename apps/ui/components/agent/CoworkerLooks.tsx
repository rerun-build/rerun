'use client'

import type { IsoAgent } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'
import { BuddyLooksProvider, type BuddyEyes, type BuddyLook, type BuddyMouth } from '@rerun/ui/iso-grid'
import { useMemo, type ReactNode } from 'react'

// The agents array changes with every status; the looks almost never. Selecting this string keeps
// every buddy of the page from drawing again each time a coworker starts or ends a run.
function looksSignature(agents: IsoAgent[]) {
    return agents.flatMap(agent => (agent.look ? [`${agent.id} ${agent.look.eyes} ${agent.look.mouth} ${agent.look.color}`] : [])).join('\n')
}

function looksOf(signature: string) {
    if (!signature) return new Map<string, BuddyLook>()
    return new Map<string, BuddyLook>(
        signature.split('\n').map(line => {
            const [id, eyes, mouth, color] = line.split(' ')
            return [id, { eyes: eyes as BuddyEyes, mouth: mouth as BuddyMouth, color }]
        }),
    )
}

// Every buddy under it wears the look its coworker was given.
export function CoworkerLooks({ children }: { children: ReactNode }) {
    const signature = useBoardStore(s => looksSignature(s.agents))
    const looks = useMemo(() => looksOf(signature), [signature])
    return <BuddyLooksProvider looks={looks}>{children}</BuddyLooksProvider>
}
