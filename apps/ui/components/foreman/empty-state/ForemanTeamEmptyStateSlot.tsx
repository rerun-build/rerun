'use client'

import { ForemanTeamEmptyState, ForemanTeamEmptyStateSkeleton } from './ForemanTeamEmptyState'
import { useForemanTeamEmptyState } from './useForemanTeamEmptyState'

export function ForemanTeamEmptyStateSlot({ onSend, onPrefill, orbPaused }: { onSend?: (text: string) => void; onPrefill?: (text: string) => void; orbPaused?: boolean }) {
    const state = useForemanTeamEmptyState()
    if (!state) return <ForemanTeamEmptyStateSkeleton />
    return <ForemanTeamEmptyState model={state.model} now={state.now} onSend={onSend} onPrefill={onPrefill} orbPaused={orbPaused} />
}
