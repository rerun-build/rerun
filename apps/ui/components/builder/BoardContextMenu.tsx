'use client'

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ShareAgentDialog } from '@/components/agent/share/ShareAgentDialog'
import { BoxAccessDialog } from '@/components/dialogs/BoxAccessDialog'
import { DeleteAgentDialog } from '@/components/dialogs/DeleteAgentDialog'
import { DeleteSpaceDialog } from '@/components/dialogs/DeleteSpaceDialog'
import { RenameAgentDialog } from '@/components/dialogs/RenameAgentDialog'
import { RenameBoxDialog } from '@/components/dialogs/RenameBoxDialog'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useBoxViewer, useCanManageAgent, useCanManageSpace, useManageableSpaceIds } from '@/hooks/useBoxAccess'
import { CopyPlusIcon, Link2, MessageCircle, PencilIcon, SettingsIcon, Trash2Icon, UsersIcon } from '@/lib/icons'
import { useBoardStore } from '@/stores/board.store'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

// A menu entry the caller sees but may not use: disabled, with the reason on hover.
function Forbidden({ reason, children }: { reason: string | undefined; children: ReactNode }) {
    if (!reason) return <>{children}</>
    return (
        <TooltipDisabledReason reason={reason} side="right" className="flex w-full">
            {children}
        </TooltipDisabledReason>
    )
}

export type BoardContextTarget = { kind: 'agent'; id: string } | { kind: 'space'; id: string }

type BoardContextMenuProps = {
    children: ReactNode
    target: BoardContextTarget | null
    onTargetClear: () => void
}

export function BoardContextMenu({ children, target, onTargetClear }: BoardContextMenuProps) {
    const t = useTranslations('builder.contextMenu')
    const agents = useBoardStore(state => state.agents)
    const spaces = useBoardStore(state => state.spaces)
    const openAgentChat = useBoardStore(state => state.openAgentChat)
    const openAgentSettings = useBoardStore(state => state.openAgentSettings)
    const requestCreation = useBoardStore(state => state.requestCreation)
    const moveAgentToBox = useBoardStore(state => state.moveAgentToBox)
    const deleteSpace = useBoardStore(state => state.deleteSpace)
    const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)
    const [renameAgentId, setRenameAgentId] = useState<string | null>(null)
    const [shareAgentId, setShareAgentId] = useState<string | null>(null)
    const [deleteSpaceId, setDeleteSpaceId] = useState<string | null>(null)
    const [renameSpaceId, setRenameSpaceId] = useState<string | null>(null)
    const [accessSpaceId, setAccessSpaceId] = useState<string | null>(null)

    const targetAgent = target?.kind === 'agent' ? agents.find(agent => agent.id === target.id) : undefined
    const targetSpace = target?.kind === 'space' ? spaces.find(space => space.id === target.id) : undefined
    const deleteAgent = deleteAgentId ? agents.find(agent => agent.id === deleteAgentId) : undefined
    const agentToRename = renameAgentId ? agents.find(agent => agent.id === renameAgentId) : undefined
    const shareAgent = shareAgentId ? agents.find(agent => agent.id === shareAgentId) : undefined
    const spaceToDelete = deleteSpaceId ? spaces.find(space => space.id === deleteSpaceId) : undefined
    const agentsInSpaceToDelete = deleteSpaceId ? agents.filter(agent => agent.spaceId === deleteSpaceId).length : 0
    const spaceToRename = renameSpaceId ? spaces.find(space => space.id === renameSpaceId) : undefined
    const spaceForAccess = accessSpaceId ? spaces.find(space => space.id === accessSpaceId) : undefined
    const workspaceAdmin = useIsWorkspaceAdmin()
    const canManageAgent = useCanManageAgent(targetAgent?.id)
    const canManageSpace = useCanManageSpace(targetSpace?.id)
    const manageableSpaceIds = useManageableSpaceIds()
    const viewer = useBoxViewer()
    const agentReason = canManageAgent ? undefined : t('manageReason')
    const spaceReason = canManageSpace ? undefined : t('manageReason')
    const otherBoxes = targetAgent ? spaces.filter(space => space.id !== targetAgent.spaceId && manageableSpaceIds.has(space.id)) : []

    return (
        <>
            <ContextMenu
                onOpenChange={open => {
                    if (!open) onTargetClear()
                }}
            >
                <ContextMenuTrigger asChild>
                    <div className="absolute inset-0">{children}</div>
                </ContextMenuTrigger>
                {targetAgent && (
                    <ContextMenuContent>
                        <ContextMenuLabel className="max-w-56 truncate pl-7">{targetAgent.name}</ContextMenuLabel>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => openAgentChat(targetAgent.id)}>
                            <MessageCircle className="size-4" />
                            {t('openChat')}
                        </ContextMenuItem>
                        <Forbidden reason={agentReason}>
                            <ContextMenuItem disabled={!canManageAgent} className="w-full" onSelect={() => setRenameAgentId(targetAgent.id)}>
                                <PencilIcon className="size-4" />
                                {t('rename')}
                            </ContextMenuItem>
                        </Forbidden>
                        <ContextMenuItem onSelect={() => openAgentSettings(targetAgent.id)}>
                            <SettingsIcon className="size-4" />
                            {t('settings')}
                        </ContextMenuItem>
                        <Forbidden reason={agentReason}>
                            <ContextMenuItem disabled={!canManageAgent} className="w-full" onSelect={() => setShareAgentId(targetAgent.id)}>
                                <Link2 className="size-4" />
                                {t('share')}
                            </ContextMenuItem>
                        </Forbidden>
                        <Forbidden reason={agentReason}>
                            <ContextMenuItem disabled={!canManageAgent} className="w-full" onSelect={() => requestCreation({ kind: 'duplicate', agentId: targetAgent.id, agentName: targetAgent.name }, viewer)}>
                                <CopyPlusIcon className="size-4" />
                                {t('duplicate')}
                            </ContextMenuItem>
                        </Forbidden>
                        <ContextMenuSub>
                            <Forbidden reason={agentReason}>
                                <ContextMenuSubTrigger disabled={!canManageAgent} className="w-full pl-7">
                                    {t('moveToBox')}
                                </ContextMenuSubTrigger>
                            </Forbidden>
                            <ContextMenuSubContent>
                                {otherBoxes.length === 0 ? (
                                    <ContextMenuItem disabled>{t('noOtherBox')}</ContextMenuItem>
                                ) : (
                                    otherBoxes.map(space => (
                                        <ContextMenuItem key={space.id} className="max-w-56 truncate" onSelect={() => moveAgentToBox(targetAgent.id, space.id, viewer)}>
                                            {space.name || t('untitledBox')}
                                        </ContextMenuItem>
                                    ))
                                )}
                            </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuSeparator />
                        <Forbidden reason={agentReason}>
                            <ContextMenuItem variant="destructive" disabled={!canManageAgent} className="w-full" onSelect={() => setDeleteAgentId(targetAgent.id)}>
                                <Trash2Icon className="size-4" />
                                {t('delete')}
                            </ContextMenuItem>
                        </Forbidden>
                    </ContextMenuContent>
                )}
                {targetSpace && (
                    <ContextMenuContent>
                        <ContextMenuLabel className="max-w-56 truncate pl-7">{targetSpace.name || t('untitledBox')}</ContextMenuLabel>
                        <ContextMenuSeparator />
                        <Forbidden reason={spaceReason}>
                            <ContextMenuItem disabled={!canManageSpace} className="w-full" onSelect={() => setRenameSpaceId(targetSpace.id)}>
                                <PencilIcon className="size-4" />
                                {t('rename')}
                            </ContextMenuItem>
                        </Forbidden>
                        <Forbidden reason={workspaceAdmin ? undefined : t('boxAccessAdminOnly')}>
                            <ContextMenuItem disabled={!workspaceAdmin} className="w-full" onSelect={() => setAccessSpaceId(targetSpace.id)}>
                                <UsersIcon className="size-4" />
                                {t('manageAccess')}
                            </ContextMenuItem>
                        </Forbidden>
                        <ContextMenuSeparator />
                        <Forbidden reason={spaceReason}>
                            <ContextMenuItem variant="destructive" disabled={!canManageSpace} className="w-full" onSelect={() => setDeleteSpaceId(targetSpace.id)}>
                                <Trash2Icon className="size-4" />
                                {t('delete')}
                            </ContextMenuItem>
                        </Forbidden>
                    </ContextMenuContent>
                )}
            </ContextMenu>

            {shareAgentId && (
                <ShareAgentDialog
                    agentId={shareAgentId}
                    agentName={shareAgent?.name ?? t('thisCoworker')}
                    open
                    onOpenChange={open => {
                        if (!open) setShareAgentId(null)
                    }}
                />
            )}

            {deleteAgentId && (
                <DeleteAgentDialog
                    agentId={deleteAgentId}
                    agentName={deleteAgent?.name}
                    open
                    onOpenChange={open => {
                        if (!open) setDeleteAgentId(null)
                    }}
                />
            )}

            <RenameAgentDialog
                agent={agentToRename}
                open={!!renameAgentId}
                onOpenChange={open => {
                    if (!open) setRenameAgentId(null)
                }}
            />

            <RenameBoxDialog
                space={spaceToRename}
                open={!!renameSpaceId}
                onOpenChange={open => {
                    if (!open) setRenameSpaceId(null)
                }}
            />

            <BoxAccessDialog
                spaceId={accessSpaceId}
                boxName={spaceForAccess?.name}
                open={!!accessSpaceId}
                onOpenChange={open => {
                    if (!open) setAccessSpaceId(null)
                }}
            />

            <DeleteSpaceDialog
                open={!!deleteSpaceId}
                spaceId={deleteSpaceId ?? undefined}
                spaceName={spaceToDelete?.name ?? undefined}
                agentCount={agentsInSpaceToDelete}
                onOpenChange={open => {
                    if (!open) setDeleteSpaceId(null)
                }}
                onConfirm={() => {
                    if (deleteSpaceId) deleteSpace(deleteSpaceId, viewer)
                    setDeleteSpaceId(null)
                }}
            />
        </>
    )
}
