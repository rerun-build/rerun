'use client'

import { shortRelativeTime } from '@rerun/i18n/format'
import { coworkerLine, type CoworkerLineTone } from '@rerun/contracts'
import { AgentBuddy, buddyMoodOfStatus } from '@rerun/ui/iso-grid'
import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent, useManageableSpaceIds } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import type { IsoAgent } from '@/lib/board/types'
import { ArrowRightIcon, CopyPlusIcon, EllipsisIcon, MessageCircle, PanelRightIcon, PlusIcon, StarIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import type { CoworkerPreview } from '@/stores/coworker-previews.store'

const LINE_TONE: Record<CoworkerLineTone, string> = {
    muted: 'text-muted-foreground',
    waiting: 'text-orange-500 dark:text-orange-400',
    destructive: 'text-destructive',
}

// What the tile's menus offer. The phone's list, where the chat and the card are the panel's, leaves
// the first three out.
export type CoworkerTileActions = {
    onNewConversation?: () => void
    onAllConversations?: () => void
    onOpenCard?: () => void
    onDuplicate: () => void
    onMoveToBox: (spaceId: string) => void
    // On the phone's list, where a coworker is pinned to the top.
    pin?: { pinned: boolean; onToggle: () => void }
}

type CoworkerTileProps = {
    agent: IsoAgent
    preview: CoworkerPreview | undefined
    // The person reading: their own last message reads "You: …".
    viewerId: string | null
    selected: boolean
    // A run finished that nobody has opened yet.
    unseen: boolean
    onOpen: () => void
    actions: CoworkerTileActions
    // `large`: the phone's list, at the sizes of the iOS and Android app.
    size?: 'compact' | 'large'
}

/** One coworker in the Simple view's list: its buddy, its name, when it last spoke, and one line of where it stands. */
export function CoworkerTile({ agent, preview, viewerId, selected, unseen, onOpen, actions, size = 'compact' }: CoworkerTileProps) {
    const t = useTranslations('workspaceView')
    const locale = useLocale()
    const paused = !!agent.disabledAt
    const lastMessage = preview?.lastMessage ? { text: preview.lastMessage.text, mine: preview.lastMessage.from === 'user' && preview.lastMessage.authorId === viewerId } : null
    const line = coworkerLine({ status: agent.status, paused, description: agent.description, latest: preview ? { ...preview, lastMessage } : null }, t)
    const waiting = !paused && agent.status === 'waiting_human'
    const large = size === 'large'

    return (
        <TileMenu agent={agent} actions={actions}>
            <div className={cn('group relative flex items-center rounded-lg transition-colors', selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60')}>
                <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined} className={cn('flex min-w-0 flex-1 items-center text-left', large ? 'gap-4 py-[17px] pr-12 pl-5' : 'gap-2.5 py-2 pr-1 pl-2')}>
                    <AgentBuddy agentId={agent.id} mood={buddyMoodOfStatus(agent.status, paused)} size={large ? 48 : 32} facing="right" className="shrink-0" />
                    <span className={cn('min-w-0 flex-1', large && 'space-y-1')}>
                        <span className="flex items-baseline gap-2">
                            <span className={cn('min-w-0 flex-1 truncate', large ? 'text-[17px] leading-[22px] font-semibold' : 'text-sm font-medium')}>{agent.name}</span>
                            {preview && <span className={cn('shrink-0 tabular-nums group-hover:invisible group-focus-within:invisible', large ? 'text-[15px] text-muted-foreground/60' : 'text-[11px] text-muted-foreground [@media(hover:none)]:invisible')}>{shortRelativeTime(preview.updatedAt, locale)}</span>}
                        </span>
                        <span className="flex items-center gap-2">
                            <span className={cn('min-w-0 flex-1 truncate', large ? 'text-[15px] leading-5' : 'text-xs', LINE_TONE[line.tone])}>{line.text || '\u00a0'}</span>
                            {waiting ? <span className="size-2 shrink-0 rounded-full bg-orange-400" /> : unseen && <span className="size-2 shrink-0 rounded-full bg-brand" />}
                        </span>
                    </span>
                </button>
                <TileMoreMenu agent={agent} actions={actions} large={large} />
            </div>
        </TileMenu>
    )
}

// The same items in the right-click menu and in the "…" one, each from its own kit.
type MenuKit = {
    Item: typeof DropdownMenuItem | typeof ContextMenuItem
    Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator
    Sub: typeof DropdownMenuSub | typeof ContextMenuSub
    SubTrigger: typeof DropdownMenuSubTrigger | typeof ContextMenuSubTrigger
    SubContent: typeof DropdownMenuSubContent | typeof ContextMenuSubContent
}

const DROPDOWN_KIT: MenuKit = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator, Sub: DropdownMenuSub, SubTrigger: DropdownMenuSubTrigger, SubContent: DropdownMenuSubContent }
const CONTEXT_KIT: MenuKit = { Item: ContextMenuItem, Separator: ContextMenuSeparator, Sub: ContextMenuSub, SubTrigger: ContextMenuSubTrigger, SubContent: ContextMenuSubContent }

function TileItems({ agent, actions, kit: { Item, Separator, Sub, SubTrigger, SubContent } }: { agent: IsoAgent; actions: CoworkerTileActions; kit: MenuKit }) {
    const t = useTranslations('workspaceView.tile')
    const tMenu = useTranslations('builder.contextMenu')
    const canManage = useCanManageAgent(agent.id)
    const manageReason = useBoxManageReason()
    const spaces = useBoardStore(s => s.spaces)
    const manageable = useManageableSpaceIds()
    const otherBoxes = spaces.filter(space => space.id !== agent.spaceId && manageable.has(space.id))
    const reason = canManage ? undefined : manageReason
    return (
        <>
            {actions.onNewConversation && (
                <Item onSelect={actions.onNewConversation} className="gap-2 whitespace-nowrap">
                    <PlusIcon className="size-4" />
                    {t('newConversation')}
                </Item>
            )}
            {actions.onAllConversations && (
                <Item onSelect={actions.onAllConversations} className="gap-2 whitespace-nowrap">
                    <MessageCircle className="size-4" />
                    {t('allConversations')}
                </Item>
            )}
            {actions.onOpenCard && (
                <Item onSelect={actions.onOpenCard} className="gap-2 whitespace-nowrap">
                    <PanelRightIcon className="size-4" />
                    {t('card')}
                </Item>
            )}
            {actions.pin && (
                <Item onSelect={actions.pin.onToggle} className="gap-2 whitespace-nowrap">
                    <StarIcon className="size-4" />
                    {actions.pin.pinned ? t('unpin') : t('pin')}
                </Item>
            )}
            <Separator />
            <TooltipDisabledReason reason={reason} side="right" className="flex w-full">
                <Item disabled={!canManage} onSelect={actions.onDuplicate} className="w-full gap-2 whitespace-nowrap">
                    <CopyPlusIcon className="size-4" />
                    {tMenu('duplicate')}
                </Item>
            </TooltipDisabledReason>
            <Sub>
                <TooltipDisabledReason reason={reason} side="right" className="flex w-full">
                    <SubTrigger disabled={!canManage} className="w-full gap-2 whitespace-nowrap">
                        <ArrowRightIcon className="size-4" />
                        {tMenu('moveToBox')}
                    </SubTrigger>
                </TooltipDisabledReason>
                <SubContent>
                    {otherBoxes.length === 0 ? (
                        <Item disabled>{tMenu('noOtherBox')}</Item>
                    ) : (
                        otherBoxes.map(space => (
                            <Item key={space.id} className="max-w-56 truncate" onSelect={() => actions.onMoveToBox(space.id)}>
                                {space.name?.trim() || tMenu('untitledBox')}
                            </Item>
                        ))
                    )}
                </SubContent>
            </Sub>
        </>
    )
}

function TileMenu({ agent, actions, children }: { agent: IsoAgent; actions: CoworkerTileActions; children: ReactNode }) {
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent>
                <TileItems agent={agent} actions={actions} kit={CONTEXT_KIT} />
            </ContextMenuContent>
        </ContextMenu>
    )
}

// Where the time sits, on hover or focus: the same actions as a right click, for a mouse that does not
// know about it and for a touch screen, where it is always there.
function TileMoreMenu({ agent, actions, large }: { agent: IsoAgent; actions: CoworkerTileActions; large: boolean }) {
    const t = useTranslations('workspaceView.tile')
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('more', { name: agent.name })}
                    className={cn('absolute opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100', large ? 'top-1/2 right-3 size-8 -translate-y-1/2' : 'top-1.5 right-1.5 size-6')}
                >
                    <EllipsisIcon className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-auto">
                <TileItems agent={agent} actions={actions} kit={DROPDOWN_KIT} />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
