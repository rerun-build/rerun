'use client'

import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { AgentLockedOverlay } from '@/components/agent/AgentLockedOverlay'
import { AgentCard } from '@/components/agent/sheet/AgentCard'
import { AgentView } from '@/components/agent/sheet/AgentView'
import { useComputerEnabled } from '@/components/layout/FeatureFlagsProvider'
import { PanelSteps } from '@/components/ui/panel-steps'
import { DetailsColumn } from '@/components/workspace-view/DetailsColumn'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import type { AgentViewTab } from '@/lib/board/agent-sheet-views'
import type { IsoAgent } from '@/lib/board/types'
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

/** The coworker's card in the right column, and the screen picked on it sliding in over it. */
export function SimpleDetailsPane({ agent, open, slideIn, screen, onScreenChange, onClose, onOpenSession, onShare, onDelete }: SimpleDetailsPaneProps) {
    const t = useTranslations('workspaceView.details')
    const sessions = useBoardStore(s => s.sessions)
    const working = useMemo(() => sessions.some(s => s.agentId === agent.id && s.status === 'working'), [sessions, agent.id])
    const servicesNeedConfig = useConnectorServices(agent.id).needsConfig
    const computerEnabled = useComputerEnabled()
    const openDesktop = useDesktopStore(s => s.openDesktop)
    const { access, needsMachineReason } = useWorkspaceAccess()
    // A paused workspace has nothing to read on any screen; a coworker switched off keeps its Settings,
    // where it is switched back on or deleted to free a slot.
    const locked = access !== 'live' || (!!agent.disabledAt && screen !== 'settings')

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

    return (
        <DetailsColumn label={t('label', { name: agent.name })} open={open} slideIn={slideIn} onClose={onClose}>
            {steps}
        </DetailsColumn>
    )
}
