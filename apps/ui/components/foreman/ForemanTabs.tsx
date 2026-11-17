'use client'

import { useForemanStore } from '@/stores/foreman.store'
import { ForemanTabsBar } from '@rerun/ui/foreman'

export function ForemanTabs() {
    const tab = useForemanStore(state => (state.card ? null : state.tab))
    const setTab = useForemanStore(state => state.setTab)

    return <ForemanTabsBar tab={tab} onTabChange={setTab} />
}
