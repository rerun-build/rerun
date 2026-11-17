'use client'

import { Orb } from '@rerun/ui/foreman'
import { useTranslations } from 'next-intl'

import { AgentPanelData } from '@/components/agent/AgentPanelData'
import { AgentPanelFiles } from '@/components/agent/AgentPanelFiles'
import { AgentPanelMemories } from '@/components/agent/AgentPanelMemories'
import { AgentPanelServices } from '@/components/agent/AgentPanelServices'
import { AgentPanelTools } from '@/components/agent/AgentPanelTools'
import { AgentPanelSkills } from '@/components/agent/skills/AgentPanelSkills'
import { ForemanCard } from '@/components/foreman/ForemanCard'
import { ForemanRoutines } from '@/components/foreman/ForemanRoutines'
import { ForemanTeamConversations } from '@/components/foreman/ForemanTeamConversations'
import { Button } from '@/components/ui/button'
import { PanelSteps } from '@/components/ui/panel-steps'
import { ChevronLeftIcon, XIcon } from '@/lib/icons'
import { foremanOrbState, selectForemanOpen, useForemanStore, type ForemanCardScreen } from '@/stores/foreman.store'

// The title each screen takes in the breadcrumb, the one a coworker's screen of the same kind has.
const SCREEN_VIEWS = {
    services: 'apps',
    skills: 'skills',
    memories: 'knowledge',
    routines: 'routines',
    files: 'files',
    data: 'data',
    tools: 'settings',
} as const satisfies Record<Exclude<ForemanCardScreen, 'team'>, string>

/**
 * The Chief of Staff's card, and the screen picked on it sliding in over it: beside its chat in the
 * Simple view, over it on the board (`overChat`). `shown`: false while mounted out of sight, so nothing is read.
 */
export function ForemanDetails({ shown, onClose, overChat = false }: { shown: boolean; onClose: () => void; overChat?: boolean }) {
    const screen = useForemanStore(state => state.card?.screen ?? null)
    const agentRowId = useForemanStore(state => state.agentRowId)
    const setScreen = useForemanStore(state => state.setCardScreen)
    // Every screen but the routines reads its row: lost on an account switch, the card is all that is left.
    const shownScreen = screen === 'routines' || agentRowId ? screen : null

    return (
        <PanelSteps stepKey={shownScreen ?? 'card'} depth={shownScreen ? 1 : 0}>
            {shownScreen ? (
                <ForemanScreen screen={shownScreen} agentRowId={agentRowId} shown={shown} onBack={() => setScreen(null)} onClose={onClose} />
            ) : (
                <ForemanCard onOpen={setScreen} onClose={onClose} closeBar={!overChat} />
            )}
        </PanelSteps>
    )
}

function ForemanScreen({ screen, agentRowId, shown, onBack, onClose }: { screen: ForemanCardScreen; agentRowId: string | null; shown: boolean; onBack: () => void; onClose: () => void }) {
    const t = useTranslations('workspaceView.foreman')
    const tView = useTranslations('agent.agentView')
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
                <Button variant="ghost" size="sm" onClick={onBack} className="min-w-0 shrink pl-1.5">
                    <ChevronLeftIcon className="size-4" />
                    <Orb size={20} state={foremanOrbState({ open, activity })} />
                    <span className="truncate text-muted-foreground">{t('name')}</span>
                </Button>
                <span className="text-muted-foreground/50">/</span>
                <span className="min-w-0 truncate px-1.5 text-sm font-semibold">{screen === 'team' ? t('team.title') : tView(`views.${SCREEN_VIEWS[screen]}`)}</span>
                <Button aria-label={tView('closePanel')} variant="ghost" size="icon-sm" onClick={onClose} className="ml-auto">
                    <XIcon className="size-4" />
                </Button>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {screen === 'routines' ? <ForemanRoutines docked={false} active={shown} className="min-h-0 flex-1" /> : agentRowId && <ForemanScreenBody screen={screen} agentRowId={agentRowId} />}
            </div>
        </div>
    )
}

function ForemanScreenBody({ screen, agentRowId }: { screen: Exclude<ForemanCardScreen, 'routines'>; agentRowId: string }) {
    const dataFocus = useForemanStore(state => state.card?.dataFocus ?? null)
    const clearDataFocus = useForemanStore(state => state.clearCardDataFocus)

    switch (screen) {
        case 'services':
            return <AgentPanelServices agentId={agentRowId} />
        case 'skills':
            return <AgentPanelSkills agentId={agentRowId} />
        case 'memories':
            return <AgentPanelMemories agentId={agentRowId} />
        case 'files':
            return <AgentPanelFiles agentId={agentRowId} />
        case 'data':
            return <AgentPanelData agentId={agentRowId} initial={dataFocus} onInitialConsumed={clearDataFocus} />
        case 'team':
            return <ForemanTeamConversations agentRowId={agentRowId} />
        case 'tools':
            return <AgentPanelTools agentId={agentRowId} />
    }
}
