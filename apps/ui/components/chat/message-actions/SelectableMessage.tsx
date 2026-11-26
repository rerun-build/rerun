'use client'

import { useTranslations } from 'next-intl'
import type { MouseEvent, ReactNode } from 'react'

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { MESSAGE_ACTION_KEYS, type MessageAction } from '@/lib/chat/message-actions'
import { cn } from '@/lib/utils'

import { MessageSelectionBar } from './MessageSelectionBar'
import type { MessageActionItem } from './message-action-items'

const MENU_LABEL_KEYS = { edit: 'edit', regenerate: 'regenerate', copy: 'copy', link: 'copyLink', delete: 'delete' } as const

// A click on a link, a button or a step of the message does what it does there, and dragging over
// text to copy it selects nothing.
function isSelectionClick(event: MouseEvent<HTMLElement>): boolean {
    if (window.getSelection()?.toString()) return false
    const target = event.target as HTMLElement
    return !target.closest('a, button, input, textarea, select, summary, label, [role="button"], [role="link"], [role="menuitem"], [data-message-actions]')
}

type SelectableMessageProps = {
    messageId: string
    isUser: boolean
    selected: boolean
    items: MessageActionItem[]
    onSelect: () => void
    onAction: (action: MessageAction) => void
    children: ReactNode
}

// One message of the chat as the actions see it: a click or the arrows select it, the bar under it
// and the menu of a right click (a long press on a touch screen) run the same actions.
export function SelectableMessage({ messageId, isUser, selected, items, onSelect, onAction, children }: SelectableMessageProps) {
    const t = useTranslations('chat.messageActions')
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    data-message-id={messageId}
                    data-selected={selected || undefined}
                    onClick={event => {
                        if (isSelectionClick(event)) onSelect()
                    }}
                    className={cn('@container group/row relative -mx-2 flex scroll-mt-32 scroll-mb-4 flex-col rounded-xl px-2 py-1 transition-colors', selected ? 'bg-muted/60 ring-1 ring-border' : 'cursor-default hover:bg-muted/30')}
                >
                    {children}
                    {selected && <MessageSelectionBar items={items} isUser={isUser} onAction={onAction} />}
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-48">
                {items.map(({ action, icon: Icon, disabledReason }) => (
                    <MenuRow key={action} action={action} separated={action === 'delete'} disabled={!!disabledReason} onAction={onAction}>
                        <Icon className="size-4" />
                        {t(MENU_LABEL_KEYS[action])}
                    </MenuRow>
                ))}
            </ContextMenuContent>
        </ContextMenu>
    )
}

function MenuRow({ action, separated, disabled, onAction, children }: { action: MessageAction; separated: boolean; disabled: boolean; onAction: (action: MessageAction) => void; children: ReactNode }) {
    return (
        <>
            {separated && <ContextMenuSeparator />}
            <ContextMenuItem variant={action === 'delete' ? 'destructive' : 'default'} disabled={disabled} onSelect={() => onAction(action)}>
                {children}
                <span className="ms-auto ps-6 font-mono text-[11px] text-muted-foreground">{MESSAGE_ACTION_KEYS[action]}</span>
            </ContextMenuItem>
        </>
    )
}
