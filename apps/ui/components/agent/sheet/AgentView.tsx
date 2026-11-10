'use client'

import { AGENT_TABS } from '@/components/agent/agent-tabs'
import { AgentViewBody } from '@/components/agent/sheet/AgentViewBody'
import { usePublishedAccessEnabled } from '@/components/layout/FeatureFlagsProvider'
import { SidePanelTabSwitcher } from '@/components/layout/SidePanelTabSwitcher'
import { Button } from '@/components/ui/button'
import { useAgentBuddyMood } from '@/hooks/useAgentBuddyMood'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { useIsTemplateAuthor } from '@/hooks/useIsTemplateAuthor'
import { AGENT_SHEET_VIEWS, agentSheetViewOf, type AgentViewTab } from '@/lib/board/agent-sheet-views'
import type { IsoAgent } from '@/lib/board/types'
import { ChevronLeftIcon, XIcon } from '@/lib/icons'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

const TAB_ICONS = Object.fromEntries(AGENT_TABS.map(tab => [tab.id, tab.icon]))

type AgentViewProps = {
    agent: IsoAgent
    tab: AgentViewTab
    onTabChange: (tab: AgentViewTab) => void
    onBack: () => void
    onClose: () => void
    onOpenSession: (sessionId: string, title: string, runId: string | null) => void
    // Covers the screen's body and leaves its header, whose back button is the way out.
    overlay?: ReactNode
}

/** A screen of the coworker, in place of the thread. Its header is a breadcrumb, coworker / screen, whose first step goes back to the card. */
export function AgentView({ agent, tab, onTabChange, onBack, onClose, onOpenSession, overlay }: AgentViewProps) {
    const t = useTranslations('agent.agentView')
    const isTemplateAuthor = useIsTemplateAuthor()
    const mood = useAgentBuddyMood(agent.id)
    const servicesNeedConfig = useConnectorServices(agent.id).needsConfig
    const publishedAccess = usePublishedAccessEnabled()
    // The install editor is the template author's, and the Published tab waits for its launch:
    // anyone else sent there lands on the screen's first tab.
    const hidden = (id: AgentViewTab) => (id === 'setup' && !isTemplateAuthor) || (id === 'published' && !publishedAccess)
    const shown: AgentViewTab = hidden(tab) ? AGENT_SHEET_VIEWS[agentSheetViewOf(tab)][0] : tab
    const view = agentSheetViewOf(shown)
    const switcherTabs = (AGENT_SHEET_VIEWS[view] as readonly AgentViewTab[])
        .filter(id => !hidden(id))
        .map(id => ({ id, icon: TAB_ICONS[id], label: t(`tabs.${id}`), dot: id === 'services' && servicesNeedConfig }))

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
                <Button variant="ghost" size="sm" onClick={onBack} className="min-w-0 shrink pl-1.5">
                    <ChevronLeftIcon className="size-4" />
                    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-muted">
                        <AgentBuddy agentId={agent.id} mood={mood} size={16} facing="right" />
                    </span>
                    <span className="truncate text-muted-foreground">{agent.name}</span>
                </Button>
                <span className="text-muted-foreground/50">/</span>
                <span className="shrink-0 px-1.5 text-sm font-semibold">{t(`views.${view}`)}</span>
                <Button aria-label={t('closePanel')} variant="ghost" size="icon-sm" onClick={onClose} className="ml-auto">
                    <XIcon className="size-4" />
                </Button>
            </div>
            <SidePanelTabSwitcher tabs={switcherTabs} value={shown} onChange={onTabChange} />
            <div className="relative min-h-0 flex-1 overflow-hidden">
                <div className="absolute inset-0 flex flex-col">
                    <AgentViewBody agent={agent} tab={shown} onOpenSession={onOpenSession} />
                </div>
                {overlay && <div className="absolute inset-0 z-10 flex flex-col bg-background">{overlay}</div>}
            </div>
        </div>
    )
}
