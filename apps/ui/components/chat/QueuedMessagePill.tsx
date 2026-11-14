'use client'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { TooltipDisabledReason, TooltipProvider } from '@/components/ui/tooltip'
import { queuedPreview } from '@/lib/chat/queued-message'
import { ClockIcon, CornerDownLeftIcon, PaperclipIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Badge, Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type QueuedMessagePillProps = {
    text: string | null
    busy: boolean
    pending: boolean
    onSendNow: () => void
    onDiscard: () => void
}

export function QueuedMessagePill({ text, busy, pending, onSendNow, onDiscard }: QueuedMessagePillProps) {
    const t = useTranslations('chat.queued')
    const [lastText, setLastText] = useState(text ?? '')
    if (text !== null && text !== lastText) setLastText(text)

    const preview = queuedPreview(text ?? lastText)
    const waiting = pending ? t('stopping') : undefined

    return (
        <TooltipProvider>
            <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', text !== null ? '-mb-px grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <div className="overflow-hidden">
                    <div className="relative mx-2 flex items-center gap-2 rounded-t-lg border-x border-t border-input bg-input/30 px-2 pt-1 pb-1.5">
                        <Stripes className="rounded-t-lg" />
                        <Badge className="relative" tone="brand" size="xs" leading={<ClockIcon className="size-3" />}>
                            {t('badge')}
                        </Badge>
                        <span className="relative min-w-0 flex-1 truncate text-muted-foreground text-xs" title={preview.text || undefined}>
                            {preview.text || t('attachmentsOnly')}
                        </span>
                        {preview.attachments.length > 0 && (
                            <span className="relative flex shrink-0 items-center gap-1 text-muted-foreground text-xs" title={preview.attachments.join(', ')}>
                                <PaperclipIcon className="size-3" />
                                {preview.attachments.length}
                            </span>
                        )}
                        <TooltipDisabledReason reason={waiting} className="relative shrink-0">
                            <PromptInputButton className="relative" tooltip={waiting ? undefined : busy ? t('sendNowStops') : t('sendNow')} aria-label={t('sendNowLabel')} disabled={pending} onClick={onSendNow}>
                                <CornerDownLeftIcon className="size-4 rotate-90" />
                            </PromptInputButton>
                        </TooltipDisabledReason>
                        <TooltipDisabledReason reason={waiting} className="relative shrink-0">
                            <PromptInputButton className="relative" tooltip={waiting ? undefined : t('remove')} aria-label={t('removeLabel')} disabled={pending} onClick={onDiscard}>
                                <XIcon className="size-4" />
                            </PromptInputButton>
                        </TooltipDisabledReason>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    )
}
