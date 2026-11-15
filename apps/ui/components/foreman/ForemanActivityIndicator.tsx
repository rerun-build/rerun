'use client'

import { Orb } from '@/components/foreman/Orb'
import { LOADER_ORB_SIZE } from '@/components/foreman/constants'
import { foremanOrbState, selectForemanOpen, useForemanStore } from '@/stores/foreman.store'

export function ForemanActivityIndicator() {
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)

    return <Orb size={LOADER_ORB_SIZE} state={foremanOrbState({ open, activity })} paused={!open} facing="right" className="shrink-0" />
}
