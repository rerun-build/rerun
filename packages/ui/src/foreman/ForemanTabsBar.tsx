'use client'

import { Tabs, TabsList, TabsTrigger } from '../primitives'
import { TooltipDisabledReason } from '../Tooltip'
import { useKitTranslations } from '../locale'

export type ForemanTab = 'assistant' | 'tasks' | 'routines'

export const FOREMAN_TABS: readonly { id: ForemanTab; disabledReason?: string }[] = [{ id: 'assistant' }, { id: 'routines' }]

export function ForemanTabsBar({ tab, onTabChange }: { tab: ForemanTab; onTabChange: (tab: ForemanTab) => void }) {
    const t = useKitTranslations()
    return (
        <Tabs value={tab} onValueChange={value => onTabChange(value as ForemanTab)} className="mx-2 border-b border-border">
            <TabsList aria-label="Foreman" className="h-9 gap-0">
                {FOREMAN_TABS.map(({ id, disabledReason }) => (
                    <TooltipDisabledReason key={id} reason={disabledReason} side="bottom" className="h-full rounded-md">
                        <TabsTrigger value={id} disabled={Boolean(disabledReason)}>
                            {t(`foreman.tabs.${id}`)}
                        </TabsTrigger>
                    </TooltipDisabledReason>
                ))}
            </TabsList>
        </Tabs>
    )
}
