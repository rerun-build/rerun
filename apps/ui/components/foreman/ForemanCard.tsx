'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { Orb } from '@rerun/ui/foreman'
import { useTranslations } from 'next-intl'
import { type ReactNode, useMemo, useState } from 'react'

import { type CardDestination, DestinationRow, DestinationTile } from '@/components/agent/sheet/AgentCard'
import { AgentView } from '@/components/agent/sheet/AgentView'
import { PanelSteps } from '@/components/ui/panel-steps'
import type { AgentViewTab } from '@/lib/board/agent-sheet-views'
import type { IsoAgent } from '@/lib/board/types'
import { useSession } from '@/supabase/session/SessionProvider'

// The tile a coworker's card opens its apps from, here on the servers connected to the Chief of
// Staff: the apps of the catalog are installed on a coworker's row, which it does not have.
const TILES: { tile: CardDestination; screen: AgentViewTab }[] = [
    { tile: 'services', screen: 'mcp' },
    { tile: 'skills', screen: 'skills' },
    { tile: 'memories', screen: 'memories' },
    { tile: 'scheduled', screen: 'scheduled' },
]

// What needs a row or a place on the board: an app of the catalog, a published page, a webhook address.
const WITHOUT_TABS: readonly AgentViewTab[] = ['services', 'published', 'triggers']

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
    const [screen, setScreen] = useState<AgentViewTab | null>(null)

    return (
        <PanelSteps stepKey={screen ?? 'card'} depth={screen ? 1 : 0}>
            {screen ? (
                <AgentView
                    agent={agent}
                    tab={screen}
                    onTabChange={setScreen}
                    onBack={() => setScreen(null)}
                    onClose={onClose}
                    onOpenSession={onClose}
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
