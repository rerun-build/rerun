'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ReactNode } from 'react'

export const DIALOG_TABS_CONTENT = 'gap-0 overflow-hidden p-0 max-sm:h-[85dvh] sm:max-w-3xl'

// The header is the caller's: a DialogTitle needs a Dialog around it, which a lab laying the
// dialog flat does not have. The header bar and the tabs read as one band, so the line under the
// header moves under the tabs.
export function DialogTabs<T extends string>({ tabs, tab, onTabChange, header, children }: { tabs: readonly { value: T; label: string }[]; tab: T; onTabChange: (tab: T) => void; header: ReactNode; children: ReactNode }) {
    return (
        <Tabs value={tab} onValueChange={value => onTabChange(value as T)} className="min-h-0 w-full flex-1 sm:h-[min(40rem,88dvh)]">
            <div className="shrink-0 border-b [&_[data-slot=dialog-header]]:border-b-0">
                {header}
                <TabsList className="max-w-full overflow-x-auto px-1 [scrollbar-width:none]">
                    {tabs.map(({ value, label }) => (
                        <TabsTrigger key={value} value={value}>
                            {label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </Tabs>
    )
}
