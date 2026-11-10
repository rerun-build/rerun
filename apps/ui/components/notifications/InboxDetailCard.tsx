'use client'

import { ATTENTION_STATUS_META, AttentionBuddy, type InboxEntry } from '@rerun/ui/inbox'
import { Button } from '@rerun/ui/primitives'
import { shortRelativeTime } from '@rerun/ui/time'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { useLocale, useTranslations } from 'next-intl'
import { Streamdown } from 'streamdown'

import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { ArrowRight, CheckCheckIcon, XIcon } from '@/lib/icons'

const streamdownPlugins = { cjk, code, math, mermaid }

type InboxDetailCardProps = {
    entry: InboxEntry
    /** The full markdown message, where the row only had room for its first line. */
    message: string
    total: number
    onClose: () => void
    onSeeAll: () => void
    /** Left out when there is no agent to open a conversation with. */
    onOpenConversation?: () => void
    /** Left out until the update has its row in the list. */
    onMarkRead?: () => void
}

export function InboxDetailCard({ entry, message, total, onClose, onSeeAll, onOpenConversation, onMarkRead }: InboxDetailCardProps) {
    const t = useTranslations('notifications.inbox.detail')
    const locale = useLocale()
    const status = (Object.hasOwn(ATTENTION_STATUS_META, entry.status) ? entry.status : 'waiting_human') as 'error' | 'awaiting_question' | 'awaiting_approval' | 'awaiting_ack' | 'done' | 'waiting_human'
    const subtitle = [entry.title || t(`status.${status}`), entry.updatedAt && shortRelativeTime(entry.updatedAt, locale)].filter(Boolean).join(' · ')

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-start gap-2.5">
                <AttentionBuddy agentId={entry.agentId} status={entry.status} />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{entry.agentName}</span>
                    <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={t('close')} onClick={onClose}>
                    <XIcon className="size-3.5" />
                </Button>
            </div>
            <div className="max-h-40 overflow-y-auto text-sm break-words text-foreground/80 [&_li]:my-0.5 [&_ol]:my-1 [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                <Streamdown plugins={streamdownPlugins}>{message}</Streamdown>
            </div>
            <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" onClick={onSeeAll}>
                    {total > 0 ? t('seeAllCount', { count: total }) : t('seeAll')}
                </Button>
                <div className="flex items-center gap-1.5">
                    {onMarkRead ? (
                        <TooltipLabeled label={t('markRead')}>
                            <Button size="icon-sm" variant="outline" aria-label={t('markRead')} onClick={onMarkRead}>
                                <CheckCheckIcon className="size-3.5" />
                            </Button>
                        </TooltipLabeled>
                    ) : (
                        <TooltipDisabledReason reason={t('notInList')}>
                            <Button size="icon-sm" variant="outline" aria-label={t('markRead')} disabled>
                                <CheckCheckIcon className="size-3.5" />
                            </Button>
                        </TooltipDisabledReason>
                    )}
                    {onOpenConversation ? (
                        <Button size="sm" onClick={onOpenConversation}>
                            {t('openConversation')}
                            <ArrowRight className="size-3.5" />
                        </Button>
                    ) : (
                        <TooltipDisabledReason reason={t('noCoworker')}>
                            <Button size="sm" disabled>
                                {t('openConversation')}
                                <ArrowRight className="size-3.5" />
                            </Button>
                        </TooltipDisabledReason>
                    )}
                </div>
            </div>
        </div>
    )
}
