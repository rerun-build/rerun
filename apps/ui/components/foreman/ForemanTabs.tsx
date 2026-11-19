'use client'

import { useForemanStore } from '@/stores/foreman.store'
import { ForemanTabsBar } from '@moldwright/ui/foreman'

export function ForemanTabs() {
    const tab = useForemanStore(state => state.tab)
    const setTab = useForemanStore(state => state.setTab)

    return <ForemanTabsBar tab={tab} onTabChange={setTab} />
}
