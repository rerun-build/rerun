'use client'

import { ViewModeSwitch } from '@/components/workspace-view/ViewModeSwitch'
import type { WorkspaceView } from '@/lib/workspace-view'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { ClassicApp } from './ClassicApp'
import { ForemanAccent } from './ForemanAccent'
import { PanelPage } from './PanelPage'
import { PanelStage, PanelWindow } from './PanelStage'
import { WorkspaceScene } from './WorkspaceScene'

const WIDTH = 790
const HEIGHT = 654

// A window of the app holding the view picked, full size. The switch in its bar is the app's own, and
// changes the pick like the tiles do.
export function ViewPanel({ view, onView, person }: { view: WorkspaceView; onView: (view: WorkspaceView) => void; person: string }) {
    const t = useTranslations('onboarding.view.panel')
    const tSwitch = useTranslations('workspaceView.switch')
    return (
        <PanelPage title={t(`${view}.title`)} line={t(`${view}.line`)}>
            <PanelStage
                width={WIDTH}
                height={HEIGHT}
                maxScale={0.75}
                float={false}
                accent={<ForemanAccent facing="left" className="right-8" />}
                controls={
                    <div className="absolute top-1.5 end-2 z-20">
                        <ViewModeSwitch value={view} onChange={onView} className="scale-90" />
                    </div>
                }
            >
                <PanelWindow>
                    <div className="flex h-14 shrink-0 items-center border-b border-border px-4 text-sm font-medium text-muted-foreground">{tSwitch(view)}</div>
                    <div className="relative min-h-0 flex-1">
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div key={view} className="absolute inset-0" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                                {view === 'board' ? <WorkspaceScene className="size-full bg-background" /> : <ClassicApp person={person} />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </PanelWindow>
            </PanelStage>
        </PanelPage>
    )
}
