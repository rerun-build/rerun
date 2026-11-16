'use client'

import { UpgradePill } from '@rerun/cloud/billing.client'
import { CardAvatar } from '@rerun/ui/chat'
import { EmptyState, useScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { memo, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { GettingStartedPill } from '@/components/foreman/getting-started/GettingStartedPill'
import { HelpButton } from '@/components/layout/HelpButton'
import { WorkspaceInbox } from '@/components/notifications/WorkspaceInbox'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { BoxAccessDialog } from '@/components/dialogs/BoxAccessDialog'
import { DeleteSpaceDialog } from '@/components/dialogs/DeleteSpaceDialog'
import { RenameBoxDialog } from '@/components/dialogs/RenameBoxDialog'
import { CoworkerTile, type CoworkerTileActions } from '@/components/workspace-view/CoworkerTile'
import { ForemanTile } from '@/components/workspace-view/ForemanTile'
import { SidebarBoxList } from '@/components/workspace-view/SidebarBoxList'
import type { BoxDialogKind } from '@/components/workspace-view/SidebarBoxSection'
import { useBoxViewer } from '@/hooks/useBoxAccess'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { readProfile } from '@/lib/auth/user-profile'
import type { IsoAgent } from '@/lib/board/types'
import { loadCollapsedBoxes, saveCollapsedBoxes, sidebarSections } from '@/lib/workspace-view'
import { BoxIcon, CirclePlusIcon, GridIcon, PlusIcon, SearchIcon, SettingsIcon, UsersIcon } from '@/lib/icons'
import { useAccountStore } from '@/stores/account.store'
import { useBoardStore } from '@/stores/board.store'
import { useBuilderDialogsStore } from '@/stores/builder-dialogs.store'
import { useControlCenterStore } from '@/stores/control-center.store'
import { useCoworkerPreviewsStore } from '@/stores/coworker-previews.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useIsWorkspaceAdmin, useSession } from '@/supabase/session/SessionProvider'

const TILE_SKELETONS = 4

type SimpleSidebarProps = {
    onOpenCoworker: (agentId: string) => void
    actionsFor: (agentId: string) => CoworkerTileActions
}

/**
 * The left column of the Simple view: the workspace, search and what needs the person, then the Chief
 * of Staff and the coworkers by Box, and the person at its foot.
 */
export const SimpleSidebar = memo(function SimpleSidebar({ onOpenCoworker, actionsFor }: SimpleSidebarProps) {
    const t = useTranslations('workspaceView.list')
    const tBuilder = useTranslations('builder.toolbar')
    const tAccess = useTranslations('workspace.access')
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const previews = useCoworkerPreviewsStore(s => s.byAgent)
    const previewsLoaded = useCoworkerPreviewsStore(s => s.loaded)
    const unseenRuns = useUnseenRunsStore(s => s.runs)
    const openControlCenter = useControlCenterStore(s => s.openControlCenter)
    const openNewAgent = useBuilderDialogsStore(s => s.openNewAgent)
    const openLibrary = useBuilderDialogsStore(s => s.openLibrary)
    const setNewBoxOpen = useBuilderDialogsStore(s => s.setNewBoxOpen)
    const { needsMachineReason } = useWorkspaceAccess()
    const { user, workspace } = useSession()
    const workspaceId = workspace?.id ?? null
    const singleBoxReason = workspace?.is_sandbox ? tAccess('sandboxSingleBox') : undefined

    const sections = useMemo(() => sidebarSections(agents, spaces), [agents, spaces])
    const [collapsed, setCollapsed] = useState<string[]>([])
    useEffect(() => setCollapsed(workspaceId ? loadCollapsedBoxes(workspaceId) : []), [workspaceId])
    const toggleBox = (boxId: string) => {
        if (!workspaceId) return
        const next = collapsed.includes(boxId) ? collapsed.filter(id => id !== boxId) : [...collapsed, boxId]
        setCollapsed(next)
        saveCollapsedBoxes(workspaceId, next)
    }
    const [boxDialog, setBoxDialog] = useState<{ kind: BoxDialogKind; boxId: string } | null>(null)
    const unseenAgents = useMemo(() => new Set(unseenRuns.map(run => run.agent_id)), [unseenRuns])
    const [listElement, setListElement] = useState<HTMLElement | null>(null)
    const listFade = useScrollFade(listElement)

    return (
        <aside className="flex h-full min-h-0 w-full flex-col">
            {/* As tall as the chat's tabs beside it, so both lines run as one. */}
            <div className="flex h-12 shrink-0 items-center border-b border-border px-2">
                <WorkspaceSwitcher placement="column" />
            </div>

            <div className="space-y-0.5 px-3 pt-2 pb-2">
                <button type="button" onClick={openControlCenter} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <SearchIcon className="size-4 shrink-0" />
                    <span className="truncate">{t('search')}</span>
                </button>
                <WorkspaceInbox trigger="row" />
            </div>

            <div className="flex items-center gap-1 pt-2 pr-3 pb-1 pl-5">
                <h2 className="text-xs font-medium text-muted-foreground">{t('label')}</h2>
                <span className="flex-1" />
                <TooltipDisabledReason reason={singleBoxReason}>
                    <TooltipLabeled label={t('newBox')}>
                        <Button variant="ghost" size="icon-sm" aria-label={t('newBox')} disabled={!!singleBoxReason} onClick={() => setNewBoxOpen(true)}>
                            <BoxIcon className="size-4" />
                        </Button>
                    </TooltipLabeled>
                </TooltipDisabledReason>
                <TooltipDisabledReason reason={needsMachineReason ?? undefined}>
                    <TooltipLabeled label={tBuilder('newCoworker')}>
                        <Button variant="ghost" size="icon-sm" aria-label={tBuilder('newCoworker')} disabled={!!needsMachineReason} onClick={openNewAgent}>
                            <PlusIcon className="size-4" />
                        </Button>
                    </TooltipLabeled>
                </TooltipDisabledReason>
            </div>

            <nav ref={setListElement} aria-label={t('label')} className="min-h-0 flex-1 overflow-y-auto px-2" style={{ maskImage: listFade, WebkitMaskImage: listFade }}>
                <div className="space-y-0.5 pb-2">
                    <ForemanTile />
                    {!previewsLoaded ? (
                        <TileSkeletons />
                    ) : agents.length === 0 && sections.length <= 1 ? (
                        <EmptyState
                            icon={UsersIcon}
                            title={t('empty')}
                            action={
                                <div className="flex flex-wrap justify-center gap-2">
                                    <TooltipDisabledReason reason={needsMachineReason ?? undefined}>
                                        <Button size="sm" disabled={!!needsMachineReason} onClick={openNewAgent}>
                                            <CirclePlusIcon className="size-4" />
                                            {tBuilder('newCoworker')}
                                        </Button>
                                    </TooltipDisabledReason>
                                    <TooltipDisabledReason reason={needsMachineReason ?? undefined}>
                                        <Button size="sm" variant="outline" disabled={!!needsMachineReason} onClick={() => openLibrary()}>
                                            <GridIcon className="size-4" />
                                            {tBuilder('template')}
                                        </Button>
                                    </TooltipDisabledReason>
                                </div>
                            }
                        />
                    ) : (
                        <SidebarBoxList
                            sections={sections}
                            collapsed={collapsed}
                            onToggle={toggleBox}
                            onDialog={(kind, boxId) => setBoxDialog({ kind, boxId })}
                            renderTile={(agent: IsoAgent) => <CoworkerTile agent={agent} preview={previews[agent.id]} viewerId={user?.id ?? null} selected={agent.id === selectedAgentId} unseen={unseenAgents.has(agent.id)} onOpen={() => onOpenCoworker(agent.id)} actions={actionsFor(agent.id)} />}
                        />
                    )}
                </div>
            </nav>

            <SidebarFoot />
            <BoxDialogs dialog={boxDialog} onClose={() => setBoxDialog(null)} />
        </aside>
    )
})

// The Box menu's dialogs, the same as on the board.
function BoxDialogs({ dialog, onClose }: { dialog: { kind: BoxDialogKind; boxId: string } | null; onClose: () => void }) {
    const spaces = useBoardStore(s => s.spaces)
    const agents = useBoardStore(s => s.agents)
    const deleteSpace = useBoardStore(s => s.deleteSpace)
    const viewer = useBoxViewer()
    const box = dialog ? spaces.find(space => space.id === dialog.boxId) : undefined
    const kind = box ? dialog?.kind : undefined
    const closeOn = (open: boolean) => {
        if (!open) onClose()
    }
    return (
        <>
            <RenameBoxDialog space={kind === 'rename' ? box : undefined} open={kind === 'rename'} onOpenChange={closeOn} />
            <BoxAccessDialog spaceId={kind === 'access' && box ? box.id : null} boxName={box?.name} open={kind === 'access'} onOpenChange={closeOn} />
            <DeleteSpaceDialog
                open={kind === 'delete'}
                spaceId={box?.id}
                spaceName={box?.name ?? undefined}
                agentCount={box ? agents.filter(agent => agent.spaceId === box.id).length : 0}
                onOpenChange={closeOn}
                onConfirm={() => {
                    if (box) deleteSpace(box.id, viewer)
                    onClose()
                }}
            />
        </>
    )
}

// Getting started and the offer while they show, then the person, help and the workspace's settings.
function SidebarFoot() {
    const tMenu = useTranslations('layout.workspaceMenu')
    const { session, workspace } = useSession()
    const workspaceAdmin = useIsWorkspaceAdmin()
    const openAccount = useAccountStore(s => s.openAccount)
    const openWorkspacePanel = useWorkspaceSettingsStore(s => s.openWorkspacePanel)
    const authUser = session?.user
    const profile = authUser ? readProfile(authUser) : null
    const label = profile?.name || accountLabel(authUser?.email) || tMenu('account')

    return (
        <div className="border-t border-border px-3 py-2">
            {/* Empty once both have nothing to show, and then it takes no room. */}
            <div className="flex flex-wrap items-center gap-2 empty:hidden has-[>*]:pb-2">
                <GettingStartedPill />
                <UpgradePill />
            </div>
            <div className="flex items-center gap-1">
                <button type="button" onClick={() => openAccount()} className="-ml-1 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-sm transition-colors hover:bg-accent">
                    <CardAvatar src={profile?.avatarUrl} name={label} className="size-6 text-[10px]" />
                    <span className="truncate">{label}</span>
                </button>
                <HelpButton trigger="icon" />
                {/* A sandbox has no settings of its own, as in the workspace menu. */}
                {!workspace?.is_sandbox && (
                    <TooltipDisabledReason reason={workspaceAdmin ? undefined : tMenu('adminOnly.settings')}>
                        <TooltipLabeled label={tMenu('settings')}>
                            <Button variant="ghost" size="icon-sm" aria-label={tMenu('settings')} disabled={!workspaceAdmin} onClick={() => openWorkspacePanel('workspace')}>
                                <SettingsIcon className="size-4" />
                            </Button>
                        </TooltipLabeled>
                    </TooltipDisabledReason>
                )}
            </div>
        </div>
    )
}

function TileSkeletons() {
    return (
        <div aria-hidden className="space-y-0.5">
            {Array.from({ length: TILE_SKELETONS }, (_, index) => (
                <div key={index} className="flex items-center gap-2.5 px-2 py-2">
                    <Skeleton className="size-8 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-3 w-40 max-w-full" />
                    </div>
                </div>
            ))}
        </div>
    )
}
