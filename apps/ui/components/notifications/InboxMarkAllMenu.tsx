'use client'

import { needsYou } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { inboxCount, type InboxItem } from '@/hooks/useInboxItems'
import { ATTENTION_STATUSES } from '@/lib/board/attention'
import type { SessionStatus } from '@/lib/board/types'
import { CheckCheckIcon, XIcon } from '@/lib/icons'
import { useBoardStore } from '@/stores/board.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'

const INFORMATIVE_STATUSES: ReadonlySet<SessionStatus> = new Set([...ATTENTION_STATUSES].filter(status => !needsYou(status)))

const waitsOnYou = (item: InboxItem) => needsYou(item.status)

function clearItems(items: InboxItem[], statuses?: ReadonlySet<SessionStatus>) {
    useBoardStore.getState().markSessionsHandled(
        items.filter(item => !item.sessionIds).map(item => item.id),
        statuses
    )
    void useUnseenRunsStore.getState().markSeen(items.flatMap(item => item.sessionIds ?? []))
}

type InboxMarkAllMenuProps = {
    items: InboxItem[]
    /** The menu is portaled out of the inbox card, which would close on its clicks. */
    onOpenChange: (open: boolean) => void
    onClearAll: (items: InboxItem[]) => void
}

// Behind the inbox's double check: what only informs leaves at once, the requests waiting on an answer only after a confirmation.
export function InboxMarkAllMenu({ items, onOpenChange, onClearAll }: InboxMarkAllMenuProps) {
    const t = useTranslations('notifications.inbox.markAll')
    // Frozen when the menu opens: what leaves is what was counted, and the closing menu does not count down to zero.
    const [listed, setListed] = useState<InboxItem[]>([])
    const informative = listed.filter(item => !waitsOnYou(item))
    const requests = listed.length - informative.length

    // The last row leaving the inbox unmounts the open menu before it reports that it closed.
    useEffect(() => () => onOpenChange(false), [onOpenChange])

    return (
        <DropdownMenu
            onOpenChange={open => {
                if (open) setListed(items)
                onOpenChange(open)
            }}
        >
            <TooltipLabeled label={t('label')}>
                <DropdownMenuTrigger asChild>
                    {/* The focus that comes back when the menu closes would open the tooltip again, over the list. */}
                    <Button size="icon-sm" variant="outline" aria-label={t('label')} onFocus={event => event.preventDefault()}>
                        <CheckCheckIcon className="size-3.5" />
                    </Button>
                </DropdownMenuTrigger>
            </TooltipLabeled>
            <DropdownMenuContent align="end" className="w-max max-w-[calc(100vw-2rem)]">
                <DropdownMenuItem disabled={informative.length === 0} onSelect={() => clearItems(informative, INFORMATIVE_STATUSES)}>
                    <CheckCheckIcon />
                    {informative.length > 0 ? t('markRead', { count: inboxCount(informative) }) : t('nothingToMark')}
                </DropdownMenuItem>
                {requests > 0 && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onClearAll(listed)}>
                            <XIcon />
                            {t('clearAll', { count: requests })}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function InboxClearAllDialog({ items, onClose }: { items: InboxItem[] | null; onClose: () => void }) {
    const t = useTranslations('notifications.inbox.markAll')
    // Kept while the dialog fades out.
    const [shown, setShown] = useState<InboxItem[]>([])
    if (items && items !== shown) setShown(items)

    return (
        <ConfirmDialog
            open={items !== null}
            onOpenChange={open => !open && onClose()}
            title={t('confirmTitle')}
            description={t('confirmDescription', { count: shown.filter(waitsOnYou).length })}
            confirmLabel={t('confirm')}
            onConfirm={() => clearItems(shown)}
        />
    )
}
