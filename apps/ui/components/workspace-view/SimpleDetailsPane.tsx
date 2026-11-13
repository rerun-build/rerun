'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { type CSSProperties, useMemo, useRef, useState } from 'react'

import { AgentLockedOverlay } from '@/components/agent/AgentLockedOverlay'
import { AgentCard } from '@/components/agent/sheet/AgentCard'
import { AgentView } from '@/components/agent/sheet/AgentView'
import { useComputerEnabled } from '@/components/layout/FeatureFlagsProvider'
import { SidePanelResizeHandle } from '@/components/layout/SidePanelResizeHandle'
import { PanelSteps } from '@/components/ui/panel-steps'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import type { AgentViewTab } from '@/lib/board/agent-sheet-views'
import type { IsoAgent } from '@/lib/board/types'
import { DETAILS_COLUMN_WIDTH } from '@/lib/workspace-view'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { useDesktopStore } from '@/stores/desktop.store'

type SimpleDetailsPaneProps = {
    agent: IsoAgent
    open: boolean
    // Mounted by a click rather than with the page: it slides in instead of being there already.
    slideIn: boolean
    screen: AgentViewTab | null
    onScreenChange: (screen: AgentViewTab | null) => void
    onClose: () => void
    onOpenSession: (sessionId: string, title: string, runId: string | null) => void
    onShare: () => void
    onDelete: () => void
}

const SLIDE = { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.22 } as const

/**
 * The right column of the Simple view: the coworker's card, and the screen picked on it sliding in
 * over it. Its left edge resizes it. Under `xl` it lies over the chat, a veil behind it.
 *
 * It stays mounted once opened, so opening it again draws nothing new. It moves by its transform alone:
 * beside the chat, the chat takes its new width once, as the column starts to slide in or once it has
 * slid out, never on every frame of the slide.
 */
export function SimpleDetailsPane({ agent, open, slideIn, screen, onScreenChange, onClose, onOpenSession, onShare, onDelete }: SimpleDetailsPaneProps) {
    const t = useTranslations('workspaceView.details')
    const columnRef = useRef<HTMLElement>(null)
    const sessions = useBoardStore(s => s.sessions)
    const working = useMemo(() => sessions.some(s => s.agentId === agent.id && s.status === 'working'), [sessions, agent.id])
    const servicesNeedConfig = useConnectorServices(agent.id).needsConfig
    const computerEnabled = useComputerEnabled()
    const openDesktop = useDesktopStore(s => s.openDesktop)
    const { access, needsMachineReason } = useWorkspaceAccess()
    // A paused workspace has nothing to read on any screen; a coworker switched off keeps its Settings,
    // where it is switched back on or deleted to free a slot.
    const locked = access !== 'live' || (!!agent.disabledAt && screen !== 'settings')
    const reducedMotion = useReducedMotion()
    // Holds the column's room until it has slid out.
    const [inFlow, setInFlow] = useState(open)
    if (open && !inFlow) setInFlow(true)

    return (
        <>
            <AnimatePresence>
                {open && (
                    <motion.button
                        type="button"
                        aria-label={t('close')}
                        onClick={onClose}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.18 }}
                        className="absolute inset-0 z-30 bg-foreground/10 backdrop-blur-[1px] xl:hidden"
                    />
                )}
            </AnimatePresence>
            <motion.aside
                aria-label={t('label', { name: agent.name })}
                aria-hidden={!open || undefined}
                inert={!open}
                ref={columnRef}
                initial={slideIn ? { x: '100%' } : false}
                animate={{ x: open ? 0 : '100%' }}
                transition={reducedMotion ? { duration: 0 } : SLIDE}
                onAnimationComplete={() => !open && setInFlow(false)}
                style={{ '--details-width': `${DETAILS_COLUMN_WIDTH.defaultWidth}px` } as CSSProperties}
                className={cn(
                    'absolute inset-y-0 right-0 z-40 flex w-(--details-width) max-w-[calc(100%-3rem)] flex-col border-l border-border bg-background shadow-2xl will-change-transform xl:relative xl:z-auto xl:max-w-[45vw] xl:shrink-0 xl:shadow-none',
                    !inFlow && 'hidden'
                )}
            >
                <SidePanelResizeHandle panelRef={columnRef} config={DETAILS_COLUMN_WIDTH} widthVar="--details-width" className="-left-2" />
                <PanelSteps stepKey={screen ?? 'card'} depth={screen ? 1 : 0}>
                    {screen ? (
                        <AgentView agent={agent} tab={screen} onTabChange={onScreenChange} onBack={() => onScreenChange(null)} onClose={onClose} onOpenSession={onOpenSession} overlay={locked && <AgentLockedOverlay agent={agent} />} />
                    ) : (
                        <AgentCard
                            agent={agent}
                            onOpen={tab => onScreenChange(tab)}
                            onClose={onClose}
                            onShare={onShare}
                            onDelete={onDelete}
                            onOpenComputer={() => openDesktop(agent.id)}
                            computerEnabled={computerEnabled}
                            working={working}
                            servicesNeedConfig={servicesNeedConfig}
                            needsMachineReason={needsMachineReason}
                            presentation="docked"
                        />
                    )}
                </PanelSteps>
            </motion.aside>
        </>
    )
}
