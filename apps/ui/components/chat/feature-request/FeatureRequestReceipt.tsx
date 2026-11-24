'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState, type ReactNode } from 'react'

import { featureRequestSentAction } from '@/app/api/_actions/feature-requests.actions'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { pendingFeatureRequest, type SentFeatureRequest } from '@/lib/chat-hitl'
import { CircleCheckIcon, MegaphoneIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { FeatureRequestBlock } from './FeatureRequestBlock'

function OutcomeRow({ icon, iconClassName, children, action }: { icon: typeof CircleCheckIcon; iconClassName?: string; children: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
            <Icon icon={icon} size="xs" className={cn('bg-transparent', iconClassName ?? 'text-muted-foreground')} />
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    )
}

export function FeatureRequestSentRow({ request }: { request: SentFeatureRequest }) {
    const t = useTranslations('chat.featureRequest')
    return (
        <OutcomeRow icon={CircleCheckIcon} iconClassName="text-emerald-500">
            {t.rich('sent', { title: request.title, muted: chunks => <span className="text-muted-foreground">{chunks}</span> })}
        </OutcomeRow>
    )
}

type SkippedProps = {
    // The request_feature call the skip answered, when the thread still holds it.
    call?: { toolCallId?: string; input?: unknown }
    // `false`: the chat could not take the reply right now.
    onSendMessage?: (opts: { text: string }) => unknown
}

// A skipped request stays one click away: Review it brings the card back, and sending from there
// tells the coworker as the card would have. Once sent that way the skip stays as history, its
// receipt being the later message, and the offer goes, after a reload too: the team's table says so.
export function FeatureRequestSkippedRow({ call, onSendMessage }: SkippedProps) {
    const t = useTranslations('chat')
    const [reviewing, setReviewing] = useState(false)
    const [sent, setSent] = useState(false)
    const toolCallId = call?.toolCallId
    const request = call?.input ? pendingFeatureRequest(call.input as Record<string, unknown>) : null
    const canReview = !sent && !!request?.title && !!toolCallId && !!onSendMessage

    useEffect(() => {
        if (!toolCallId) return
        let cancelled = false
        featureRequestSentAction(toolCallId)
            .then(found => !cancelled && found && setSent(true))
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [toolCallId])

    if (reviewing && canReview && request && call?.toolCallId && onSendMessage) {
        return (
            <FeatureRequestBlock
                request={request}
                toolCallId={call.toolCallId}
                onSkip={() => setReviewing(false)}
                onSent={text => {
                    const taken = onSendMessage({ text }) !== false
                    if (taken) setSent(true)
                    return taken
                }}
            />
        )
    }
    return (
        <OutcomeRow
            icon={MegaphoneIcon}
            action={
                canReview ? (
                    <Button size="sm" variant="ghost" onClick={() => setReviewing(true)}>
                        {t('featureRequest.reviewIt')}
                    </Button>
                ) : null
            }
        >
            {t('receipt.dismissed.feature')}
        </OutcomeRow>
    )
}
