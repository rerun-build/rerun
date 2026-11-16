'use client'

import { useTranslations } from 'next-intl'
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react'

import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageSpace } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import type { IsoAgent, SpacePublic } from '@/lib/board/types'
import { ChevronDownIcon, EllipsisIcon, PencilIcon, Trash2Icon, UsersIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'

export type BoxDialogKind = 'rename' | 'access' | 'delete'

type SidebarBoxSectionProps = {
    box: SpacePublic
    members: IsoAgent[]
    collapsed: boolean
    onToggle: () => void
    onDialog: (kind: BoxDialogKind) => void
    renderTile: (agent: IsoAgent) => ReactNode
    // Dragging the list: the section moves by its header, and lights up while a coworker hovers it.
    drag?: { ref: Ref<HTMLElement>; style: CSSProperties; handle: HTMLAttributes<HTMLDivElement>; dragging: boolean; target: boolean }
}

/** One Box in the Simple view's list: its name, folded or not, then its coworkers. */
export function SidebarBoxSection({ box, members, collapsed, onToggle, onDialog, renderTile, drag }: SidebarBoxSectionProps) {
    const t = useTranslations('workspaceView.list')
    const tMenu = useTranslations('builder.contextMenu')
    const label = box.name?.trim() || tMenu('untitledBox')
    const waiting = members.some(agent => !agent.disabledAt && agent.status === 'waiting_human')

    return (
        <section ref={drag?.ref} style={drag?.style} aria-label={label} className={cn('rounded-lg transition-colors', drag?.dragging && 'opacity-40', drag?.target && 'bg-accent/40 ring-1 ring-border')}>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div {...drag?.handle} className="group relative flex h-8 items-center rounded-md transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50">
                        <button type="button" aria-expanded={!collapsed} onClick={onToggle} className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-8 pl-2 text-left text-xs font-medium text-muted-foreground">
                            <ChevronDownIcon className={cn('size-3 shrink-0 transition-transform', collapsed && '-rotate-90')} />
                            <span className="truncate">{label}</span>
                            <span className="shrink-0 text-muted-foreground/60 tabular-nums">{members.length}</span>
                            {collapsed && waiting && <span className="size-1.5 shrink-0 rounded-full bg-orange-400" />}
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('boxMore', { name: label })}
                                    className="absolute top-1 right-1 size-6 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                                >
                                    <EllipsisIcon className="size-3.5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" side="right" className="w-auto">
                                <BoxItems boxId={box.id} onDialog={onDialog} kit={DROPDOWN_KIT} />
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <BoxItems boxId={box.id} onDialog={onDialog} kit={CONTEXT_KIT} />
                </ContextMenuContent>
            </ContextMenu>
            {!collapsed &&
                (members.length === 0 ? (
                    <p className="py-1.5 pl-7 text-xs text-muted-foreground/60">{t('emptyBox')}</p>
                ) : (
                    <ul className="space-y-0.5">
                        {members.map(agent => (
                            <li key={agent.id}>{renderTile(agent)}</li>
                        ))}
                    </ul>
                ))}
        </section>
    )
}

type MenuKit = {
    Item: typeof DropdownMenuItem | typeof ContextMenuItem
    Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator
}

const DROPDOWN_KIT: MenuKit = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator }
const CONTEXT_KIT: MenuKit = { Item: ContextMenuItem, Separator: ContextMenuSeparator }

// The Box's menu on the board, in the list: rename, who can access it, delete.
function BoxItems({ boxId, onDialog, kit: { Item, Separator } }: { boxId: string; onDialog: (kind: BoxDialogKind) => void; kit: MenuKit }) {
    const tMenu = useTranslations('builder.contextMenu')
    const canManage = useCanManageSpace(boxId)
    const manageReason = useBoxManageReason()
    const workspaceAdmin = useIsWorkspaceAdmin()
    const reason = canManage ? undefined : manageReason
    return (
        <>
            <TooltipDisabledReason reason={reason} side="right" className="flex w-full">
                <Item disabled={!canManage} onSelect={() => onDialog('rename')} className="w-full gap-2 whitespace-nowrap">
                    <PencilIcon className="size-4" />
                    {tMenu('rename')}
                </Item>
            </TooltipDisabledReason>
            <TooltipDisabledReason reason={workspaceAdmin ? undefined : tMenu('boxAccessAdminOnly')} side="right" className="flex w-full">
                <Item disabled={!workspaceAdmin} onSelect={() => onDialog('access')} className="w-full gap-2 whitespace-nowrap">
                    <UsersIcon className="size-4" />
                    {tMenu('manageAccess')}
                </Item>
            </TooltipDisabledReason>
            <Separator />
            <TooltipDisabledReason reason={reason} side="right" className="flex w-full">
                <Item variant="destructive" disabled={!canManage} onSelect={() => onDialog('delete')} className="w-full gap-2 whitespace-nowrap">
                    <Trash2Icon className="size-4" />
                    {tMenu('delete')}
                </Item>
            </TooltipDisabledReason>
        </>
    )
}
