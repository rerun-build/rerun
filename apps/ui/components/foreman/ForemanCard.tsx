'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { Orb } from '@rerun/ui/foreman'
import { useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { findForemanThreadAction } from '@/app/api/_actions/foreman-conversation.actions'
import { renameForemanAction } from '@/app/api/_actions/foreman-name.actions'
import { AgentCard, type CardDestination } from '@/components/agent/sheet/AgentCard'
import { AgentView } from '@/components/agent/sheet/AgentView'
import { WELCOME_ORB_SIZE } from '@/components/foreman/constants'
import { ForemanCheckinsRow, ForemanCheckinsScreen } from '@/components/foreman/ForemanCheckins'
import { EditableName } from '@/components/ui/editable-name'
import { PanelSteps } from '@/components/ui/panel-steps'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { useErrorText } from '@/hooks/useErrorText'
import { useForemanName } from '@/hooks/useForemanName'
import type { AgentViewTab } from '@/lib/board/agent-sheet-views'
import type { IsoAgent } from '@/lib/board/types'
import { FOREMAN_NAME_MAX } from '@/lib/foreman/name'
import { useDesktopStore } from '@/stores/desktop.store'
import { foremanOrbState, selectForemanOpen, useForemanStore } from '@/stores/foreman.store'
import { useIsWorkspaceAdmin, useSession } from '@/supabase/session/SessionProvider'

// A published page belongs to a coworker of the board for now, and the Chief of Staff installs nothing.
// Its runs are its members' own conversations: its activity shows their sum, never the list.
const WITHOUT_TABS: readonly AgentViewTab[] = ['published', 'setup', 'logs']

// An engine from before `foreman.agent` refuses the Chief of Staff's activity and settings.
const WITHOUT_AGENT_SCREENS: readonly CardDestination[] = ['monitoring', 'settings']

const BREADCRUMB_ORB_SIZE = 16

function useForemanAsAgent(): IsoAgent {
    const name = useTranslations('workspaceView.foreman')('name', useForemanName())
    const workspaceId = useSession().workspace?.id ?? 0
    return useMemo(() => ({ id: FOREMAN_AGENT_ID, kind: 'foreman', name, handle: null, description: null, templateId: null, status: 'idle', position: { col: 0, row: 0 }, workspaceId, spaceId: '', disabledAt: null, disabledReason: null }), [name, workspaceId])
}

/** Who the Chief of Staff is, on its card: its orb, its name (an admin renames it) and its line. */
export function ForemanIdentity() {
    const t = useTranslations('workspaceView.foreman')
    const foremanName = useForemanName()
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)
    const admin = useIsWorkspaceAdmin()
    const errorText = useErrorText()

    const rename = async (next: string) => {
        const result = await renameForemanAction(next)
        if (result.ok) useForemanStore.getState().setName(result.name)
        else toast.error(errorText(result))
    }

    return (
        <div className="flex shrink-0 flex-col items-center px-4 pt-4 pb-3">
            <Orb size={WELCOME_ORB_SIZE} state={foremanOrbState({ open, activity })} />
            {admin ? (
                <div className="mt-2 flex max-w-full justify-center">
                    <EditableName name={t('name', foremanName)} onRename={next => void rename(next)} label={t('rename')} maxLength={FOREMAN_NAME_MAX} allowEmpty className="text-base leading-tight font-semibold" />
                </div>
            ) : (
                <span className="mt-2 max-w-full truncate text-base leading-tight font-semibold">{t('name', foremanName)}</span>
            )}
            <span className="text-xs text-muted-foreground">{t('line')}</span>
        </div>
    )
}

/**
 * The Chief of Staff's card: a coworker's card, drawn by the rules of its kind (no share, no delete,
 * its orb), with its check-ins under its rows. `children` is what the card carries at its foot,
 * `onClose` where the close button leads, and `active` false while it is mounted out of sight.
 */
export function ForemanCard({ onClose, active = true, children }: { onClose: () => void; active?: boolean; children?: ReactNode }) {
    const agent = useForemanAsAgent()
    const admin = useIsWorkspaceAdmin()
    const screen = useForemanStore(state => state.cardScreen)
    const setScreen = useForemanStore(state => state.setCardScreen)
    const hasAgentScreens = useForemanStore(state => state.hasAgentScreens)
    const working = useForemanStore(state => state.activity !== 'idle')
    const servicesNeedConfig = useConnectorServices(FOREMAN_AGENT_ID).needsConfig
    const openDesktop = useDesktopStore(state => state.openDesktop)

    // A run of one of its routines is a thread of the member who reads it: theirs opens in its chat,
    // another member's stays with them.
    const openRun = useCallback(
        async (engineSessionId: string) => {
            const threadId = await findForemanThreadAction(engineSessionId)
            if (!threadId) return
            const store = useForemanStore.getState()
            store.setTab('assistant')
            store.openThread(threadId)
            onClose()
        },
        [onClose],
    )

    return (
        <PanelSteps stepKey={screen ?? 'card'} depth={screen ? 1 : 0}>
            {screen === 'checkins' ? (
                <ForemanCheckinsScreen name={agent.name} avatar={<Orb size={BREADCRUMB_ORB_SIZE} paused />} onBack={() => setScreen(null)} onClose={onClose} />
            ) : screen ? (
                <AgentView
                    agent={agent}
                    tab={screen}
                    onTabChange={setScreen}
                    onBack={() => setScreen(null)}
                    onClose={onClose}
                    onOpenSession={sessionId => void openRun(sessionId)}
                    avatar={<Orb size={BREADCRUMB_ORB_SIZE} paused />}
                    withoutTabs={WITHOUT_TABS}
                />
            ) : (
                <AgentCard
                    agent={agent}
                    identity={<ForemanIdentity />}
                    onOpen={tab => setScreen(tab)}
                    onClose={onClose}
                    onOpenComputer={() => openDesktop(FOREMAN_AGENT_ID)}
                    working={working}
                    servicesNeedConfig={servicesNeedConfig}
                    needsMachineReason={null}
                    presentation="docked"
                    withoutDestinations={hasAgentScreens ? undefined : WITHOUT_AGENT_SCREENS}
                    extraRows={admin && <ForemanCheckinsRow active={active} onOpen={() => setScreen('checkins')} />}
                >
                    {children}
                </AgentCard>
            )}
        </PanelSteps>
    )
}
