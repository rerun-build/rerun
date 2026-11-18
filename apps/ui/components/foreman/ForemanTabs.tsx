'use client'

import { useForemanStore } from '@/stores/foreman.store'
import { ForemanTabsBar } from '@rerun/ui/foreman'

export function ForemanTabs() {
    const tab = useForemanStore(state => state.tab)
    const setTab = useForemanStore(state => state.setTab)
    const hasCard = useForemanStore(state => state.hasCard)

    return <ForemanTabsBar tab={tab} onTabChange={setTab} card={hasCard} />
}
