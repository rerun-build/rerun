'use client'

import { UpgradePill } from '@rerun/cloud/billing.client'
import { byRecency, sectionsByBox, withPinned } from '@rerun/contracts'
import { AgentBuddy, buddyMoodOfStatus } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { BoardCornerActions } from '@/components/layout/BoardCornerActions'
import { HelpButton } from '@/components/layout/HelpButton'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Segmented } from '@/components/ui/segmented'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CoworkerTile, type CoworkerTileActions } from '@/components/workspace-view/CoworkerTile'
import { ForemanTile } from '@/components/workspace-view/ForemanTile'
import { useBoxViewer } from '@/hooks/useBoxAccess'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import type { IsoAgent } from '@/lib/board/types'
import { ChevronDownIcon, CirclePlusIcon, GridIcon, PlusIcon, SearchIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { loadGrouping, loadPins, saveGrouping, savePins, togglePin, type ListGrouping } from '@/lib/workspace-view'
import { useBoardStore } from '@/stores/board.store'
import { useBuilderDialogsStore } from '@/stores/builder-dialogs.store'
import { useControlCenterStore } from '@/stores/control-center.store'
import { useCoworkerPreviewsStore, type CoworkerPreview } from '@/stores/coworker-previews.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { useSession } from '@/supabase/session/SessionProvider'

type Listed = { agent: IsoAgent; id: string; spaceId: string; latest: CoworkerPreview | null }

/**
 * The Simple view on a phone, laid out as the iOS and Android app's Home: the workspace and a "+" at the
 * top, the coworkers pinned as discs, then the list by recency or by Box, search at the bottom. A tap
 * opens the coworker's panel as on the board; the Chief of Staff opens its own sheet.
 */
export function SimplePhoneHome() {
    const t = useTranslations('workspaceView')
    const tBuilder = useTranslations('builder.toolbar')
    const tAgent = useTranslations('agent')
    const { workspace, user } = useSession()
    const workspaceId = workspace?.id
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const previews = useCoworkerPreviewsStore(s => s.byAgent)
    const unseenRuns = useUnseenRunsStore(s => s.runs)
    const openControlCenter = useControlCenterStore(s => s.openControlCenter)
    const viewer = useBoxViewer()
    const { needsMachineReason } = useWorkspaceAccess()
    const [pins, setPins] = useState<string[]>([])
    const [grouping, setGrouping] = useState<ListGrouping>('recent')
    const [collapsed, setCollapsed] = useState<string[]>([])

    useEffect(() => {
        if (!workspaceId) return
        setPins(loadPins(workspaceId))
        setGrouping(loadGrouping(workspaceId))
    }, [workspaceId])

    const listed = useMemo<Listed[]>(() => agents.map(agent => ({ agent, id: agent.id, spaceId: agent.spaceId, latest: previews[agent.id] ?? null })), [agents, previews])
    const { pinned, others } = withPinned(listed, pins)
    const recent = useMemo(() => [...others].sort(byRecency), [others])
    const sections = sectionsByBox(others, spaces, tAgent('untitledBox'))
    const unseenAgents = useMemo(() => new Set(unseenRuns.map(run => run.agent_id)), [unseenRuns])

    const changePins = useCallback(
        (next: string[]) => {
            setPins(next)
            if (workspaceId) savePins(workspaceId, next)
        },
        [workspaceId]
    )
    const changeGrouping = (next: ListGrouping) => {
        setGrouping(next)
        if (workspaceId) saveGrouping(workspaceId, next)
    }

    const open = (agentId: string) => useBoardStore.getState().openAgentChat(agentId)
    const actionsFor = (agentId: string): CoworkerTileActions => ({
        onDuplicate: () => {
            const agent = useBoardStore.getState().agents.find(a => a.id === agentId)
            if (agent) useBoardStore.getState().requestCreation({ kind: 'duplicate', agentId, agentName: agent.name, spaceId: agent.spaceId }, viewer)
        },
        onMoveToBox: spaceId => useBoardStore.getState().moveAgentToBox(agentId, spaceId, viewer),
        pin: { pinned: pins.includes(agentId), onToggle: () => changePins(togglePin(pins, agentId)) },
    })

    const tile = ({ agent, latest }: Listed) => (
        <li key={agent.id}>
            <CoworkerTile size="large" agent={agent} preview={latest ?? undefined} viewerId={user?.id ?? null} selected={agent.id === selectedAgentId} unseen={unseenAgents.has(agent.id)} onOpen={() => open(agent.id)} actions={actionsFor(agent.id)} />
        </li>
    )

    return (
        <div className="absolute inset-0 flex flex-col bg-background">
            <header className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
                <WorkspaceSwitcher placement="column" />
                <span className="flex-1" />
                <HelpButton />
                <UpgradePill />
                <DropdownMenu>
                    <TooltipDisabledReason reason={needsMachineReason ?? undefined} className="rounded-full">
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" aria-label={tBuilder('create')} disabled={!!needsMachineReason} className="size-11 rounded-full">
                                <PlusIcon className="size-5" />
                            </Button>
                        </DropdownMenuTrigger>
                    </TooltipDisabledReason>
                    <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem onSelect={() => useBuilderDialogsStore.getState().openNewAgent()} className="gap-2 whitespace-nowrap">
                            <CirclePlusIcon className="size-4" />
                            {tBuilder('newCoworker')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => useBuilderDialogsStore.getState().openLibrary()} className="gap-2 whitespace-nowrap">
                            <GridIcon className="size-4" />
                            {tBuilder('template')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto pb-28">
                {pinned.length > 0 && (
                    <ul aria-label={t('phone.pinned')} className="grid grid-cols-3 px-3 pt-2 pb-4 min-[480px]:grid-cols-4">
                        {pinned.map(({ agent }) => (
                            <li key={agent.id}>
                                <PinnedDisc agent={agent} unseen={unseenAgents.has(agent.id) || agent.status === 'waiting_human'} onOpen={() => open(agent.id)} />
                            </li>
                        ))}
                    </ul>
                )}

                <div className="px-2">
                    <ForemanTile />
                </div>

                <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
                    <span className="text-[15px] text-muted-foreground">{grouping === 'recent' ? t('phone.recent') : t('phone.byBox')}</span>
                    <Segmented
                        className="w-40"
                        value={grouping}
                        onChange={changeGrouping}
                        options={[
                            { value: 'recent', label: t('phone.recent') },
                            { value: 'box', label: t('phone.byBox') },
                        ]}
                    />
                </div>

                {grouping === 'recent' ? (
                    <ul>{recent.map(tile)}</ul>
                ) : (
                    sections.map(section => {
                        const isCollapsed = collapsed.includes(section.key)
                        return (
                            <section key={section.key}>
                                <button
                                    type="button"
                                    aria-expanded={!isCollapsed}
                                    aria-label={t('phone.section', { label: section.label, count: section.members.length })}
                                    onClick={() => setCollapsed(current => (isCollapsed ? current.filter(key => key !== section.key) : [...current, section.key]))}
                                    className="flex items-center gap-2 px-5 pt-[18px] pb-2 text-[15px] text-muted-foreground active:opacity-60"
                                >
                                    {section.label}
                                    <ChevronDownIcon className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                                </button>
                                {!isCollapsed && <ul>{section.members.map(tile)}</ul>}
                            </section>
                        )
                    })
                )}
            </div>

            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background via-background/80 to-transparent" />
            <BoardCornerActions />
            <Button variant="outline" size="icon" aria-label={t('list.search')} onClick={openControlCenter} className="absolute right-4 bottom-[calc(1rem+var(--consent-inset))] z-40 size-11 rounded-full bg-background/80 backdrop-blur-xl">
                <SearchIcon className="size-5" />
            </Button>
        </div>
    )
}

// A pinned coworker as the app draws one: a round disc, the name under it, a dot when it has news.
function PinnedDisc({ agent, unseen, onOpen }: { agent: IsoAgent; unseen: boolean; onOpen: () => void }) {
    return (
        <button type="button" onClick={onOpen} className="flex w-full flex-col items-center gap-1.5 py-2 active:opacity-60">
            <span className="relative flex size-20 items-center justify-center rounded-full bg-muted">
                <AgentBuddy agentId={agent.id} mood={buddyMoodOfStatus(agent.status, !!agent.disabledAt)} size={56} />
                {unseen && <span className="absolute top-1.5 left-1.5 size-3.5 rounded-full border-2 border-background bg-brand" />}
            </span>
            <span className={cn('max-w-full truncate text-[13px]', unseen ? 'font-medium text-foreground' : 'text-muted-foreground')}>{agent.name}</span>
        </button>
    )
}
