'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { Orb } from '@rerun/ui/foreman'
import { useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useMemo } from 'react'

import { findForemanThreadAction } from '@/app/api/_actions/foreman-conversation.actions'
import { type CardDestination, DestinationRow, DestinationTile } from '@/components/agent/sheet/AgentCard'
import { AgentView } from '@/components/agent/sheet/AgentView'
import { PanelSteps } from '@/components/ui/panel-steps'
import type { AgentViewTab } from '@/lib/board/agent-sheet-views'
import type { IsoAgent } from '@/lib/board/types'
import { useForemanStore } from '@/stores/foreman.store'
import { useSession } from '@/supabase/session/SessionProvider'

const TILES: { tile: CardDestination; screen: AgentViewTab }[] = [
    { tile: 'services', screen: 'services' },
    { tile: 'skills', screen: 'skills' },
    { tile: 'memories', screen: 'memories' },
    { tile: 'scheduled', screen: 'scheduled' },
]

// What needs a row or a place on the board: a published page, a webhook address.
const WITHOUT_TABS: readonly AgentViewTab[] = ['published', 'triggers']

const BREADCRUMB_ORB_SIZE = 16

function useForemanAsAgent(): IsoAgent {
    const name = useTranslations('workspaceView.foreman')('name')
    const workspaceId = useSession().workspace?.id ?? 0
    return useMemo(() => ({ id: FOREMAN_AGENT_ID, name, handle: null, description: null, templateId: null, status: 'idle', position: { col: 0, row: 0 }, workspaceId, spaceId: '', disabledAt: null, disabledReason: null }), [name, workspaceId])
}

/**
 * The Chief of Staff's card: what it keeps of its own, each on the screen a coworker's card opens.
 * `lead` and `children` are what the card carries above and under its tiles, and `onClose` where
 * the close button of a screen leads.
 */
export function ForemanCard({ lead, onClose, children }: { lead?: ReactNode; onClose: () => void; children?: ReactNode }) {
    const agent = useForemanAsAgent()
    const screen = useForemanStore(state => state.cardScreen)
    const setScreen = useForemanStore(state => state.setCardScreen)

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
            {screen ? (
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
                <div className="flex min-h-0 flex-1 flex-col">
                    {lead}
                    <div className="grid shrink-0 grid-cols-4 gap-1.5 px-3 pb-1.5">
                        {TILES.map(({ tile, screen: target }) => (
                            <DestinationTile key={tile} tab={tile} onClick={() => setScreen(target)} />
                        ))}
                    </div>
                    <div className="shrink-0 px-3 pb-3">
                        <DestinationRow tab="files" onClick={() => setScreen('files')} />
                    </div>
                    {children}
                </div>
            )}
        </PanelSteps>
    )
}
