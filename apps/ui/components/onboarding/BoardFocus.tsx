'use client'

import type { BoardTeam } from '@/lib/onboarding/board-teams'
import { useOnboardingSceneStore } from '@/stores/onboarding-scene.store'
import { useEffect } from 'react'

// Puts what they arrived for on the board of the layout around the page.
export function BoardFocus({ team }: { team: BoardTeam | null }) {
    const patch = useOnboardingSceneStore(state => state.patch)
    useEffect(() => {
        patch({ focus: team })
    }, [team, patch])
    return null
}
