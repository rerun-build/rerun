'use client'

import { ScrollFade } from '@rerun/ui/primitives'
import { useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { PanelSteps } from '@/components/ui/panel-steps'

export type TilesHeader = { icon: ComponentType<{ className?: string }> | ReactNode; title: string; description: string; backLabel?: string }

// The frame every billing in tiles opens in: the one header, which goes back, and under it the home or
// the page it changes, sliding in. `scrollKey` brings the page back to its top when a step inside a
// page changes.
export function TilesFrame({ header, stepKey, depth, scrollKey, children }: { header: TilesHeader & { key: string; onBack?: () => void }; stepKey: string; depth: number; scrollKey?: string; children: ReactNode }) {
    const scrollRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 })
    }, [stepKey, scrollKey])

    return (
        <PanelDialogContent className="sm:h-[min(46rem,90dvh)] sm:max-w-2xl">
            <DialogHeaderBar icon={header.icon} title={header.title} description={header.description} onBack={header.onBack} backLabel={header.backLabel} page={{ key: header.key, depth }} />
            <ScrollFade scrollRef={scrollRef} className="@container min-h-0 flex-1">
                <div className="flex min-h-full flex-col p-4">
                    <PanelSteps stepKey={stepKey} depth={depth}>
                        {children}
                    </PanelSteps>
                </div>
            </ScrollFade>
        </PanelDialogContent>
    )
}
