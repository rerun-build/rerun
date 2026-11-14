'use client'

import { motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { type CSSProperties, useMemo, useRef, useState } from 'react'

import { AgentLockedOverlay } from '@/components/agent/AgentLockedOverlay'
import { AgentCard } from '@/components/agent/sheet/AgentCard'
import { AgentView } from '@/components/agent/sheet/AgentView'
import { useComputerEnabled } from '@/components/layout/FeatureFlagsProvider'
import { SidePanelResizeHandle } from '@/components/layout/SidePanelResizeHandle'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useDetailsBesideChat } from '@/components/workspace-view/useDetailsOpen'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import type { AgentViewTab } from '@/lib/board/agent-sheet-views'
import type { IsoAgent } from '@/lib/board/types'
import { isTypingTarget } from '@/lib/typing-target'
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
 * over it. From `xl` it sits beside the chat and its left edge resizes it; under `xl` it is a Sheet over the chat.
 *
 * Beside the chat it stays mounted once opened, so opening it again draws nothing new. It moves by its
 * transform alone: the chat takes its new width once, as the column starts to slide in or once it has
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
    const besideChat = useDetailsBesideChat()
    // Holds the column's room until it has slid out.
    const [inFlow, setInFlow] = useState(open)
    if (open && !inFlow) setInFlow(true)

    const steps = (
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
    )

    if (!besideChat) {
        return (
            <Sheet open={open} onOpenChange={next => !next && onClose()}>
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    aria-describedby={undefined}
                    onEscapeKeyDown={event => isTypingTarget(event.target) && event.preventDefault()}
                    className="gap-0 p-0 data-[side=right]:w-[calc(100%-3rem)] data-[side=right]:sm:max-w-[400px]"
                >
                    <SheetTitle className="sr-only">{t('label', { name: agent.name })}</SheetTitle>
                    {steps}
                </SheetContent>
            </Sheet>
        )
    }

    return (
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
            className={cn('relative flex w-(--details-width) max-w-[45vw] shrink-0 flex-col border-l border-border bg-background will-change-transform', !inFlow && 'hidden')}
        >
            <SidePanelResizeHandle panelRef={columnRef} config={DETAILS_COLUMN_WIDTH} widthVar="--details-width" className="-left-2" />
            {steps}
        </motion.aside>
    )
}
