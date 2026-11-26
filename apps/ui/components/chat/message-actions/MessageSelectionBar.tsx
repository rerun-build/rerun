'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { MESSAGE_ACTION_KEYS, type MessageAction } from '@/lib/chat/message-actions'
import { cn } from '@/lib/utils'

import type { MessageActionItem } from './message-action-items'

const LABEL_KEYS = { edit: 'edit', regenerate: 'regenerate', copy: 'copy', link: 'link', delete: 'delete' } as const

// Under the selected message, each action with its key. Below 480px of chat, the icons alone. Once the
// message is let go, it fades and folds away so the thread closes up smoothly instead of jumping.
export function MessageSelectionBar({ items, isUser, leaving = false, onAction }: { items: MessageActionItem[]; isUser: boolean; leaving?: boolean; onAction: (action: MessageAction) => void }) {
    const t = useTranslations('chat.messageActions')
    return (
        <div
            data-message-actions=""
            aria-hidden={leaving || undefined}
            className={cn(
                'mt-1 flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-md',
                isUser ? 'self-end' : 'self-start',
                leaving ? cn('pointer-events-none overflow-hidden animate-[message-bar-fold_200ms_cubic-bezier(0.4,0,0.2,1)_forwards]', isUser ? 'origin-top-right' : 'origin-top-left') : 'animate-in fade-in zoom-in-95'
            )}
            onClick={event => event.stopPropagation()}
        >
            {items.map(({ action, icon: Icon, disabledReason }) => (
                <TooltipDisabledReason key={action} reason={disabledReason}>
                    <Button variant="ghost" size="sm" disabled={!!disabledReason} className={cn('h-7 gap-1.5 px-2 text-xs', action === 'delete' && 'text-destructive hover:text-destructive')} onClick={() => onAction(action)} aria-label={t(LABEL_KEYS[action])} aria-keyshortcuts={MESSAGE_ACTION_KEYS[action] === '⌫' ? 'Backspace' : MESSAGE_ACTION_KEYS[action]}>
                        <Icon className="size-3.5" />
                        <span className="@max-[480px]:hidden">{t(LABEL_KEYS[action])}</span>
                        <Kbd className="@max-[480px]:hidden min-w-5 px-1 py-0 font-mono text-[10px] shadow-none">{MESSAGE_ACTION_KEYS[action]}</Kbd>
                    </Button>
                </TooltipDisabledReason>
            ))}
        </div>
    )
}
