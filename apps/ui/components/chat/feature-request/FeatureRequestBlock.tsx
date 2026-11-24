'use client'

import { FEATURE_REQUEST_LIMITS } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { sendFeatureRequestAction } from '@/app/api/_actions/feature-requests.actions'
import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { Textarea } from '@/components/ui/textarea'
import { useErrorText } from '@/hooks/useErrorText'
import { serializeFeatureRequestSent, type FeatureRequestDraft, type FeatureRequestKind } from '@/lib/chat-hitl'
import { BugIcon, CompassIcon, PencilIcon, RocketIcon, TrendingUpIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { useFeatureRequestConversation } from './FeatureRequestConversation'

const KINDS = {
    feature: { icon: RocketIcon, tone: 'brand' },
    bug: { icon: BugIcon, tone: 'red' },
    improvement: { icon: TrendingUpIcon, tone: 'cyan' },
} as const satisfies Record<FeatureRequestKind, { icon: typeof BugIcon; tone: 'brand' | 'red' | 'cyan' }>

type FeatureRequestBlockProps = {
    request: FeatureRequestDraft
    toolCallId: string
    // The reply that resumes the coworker, once the team has the request. `false`: the chat could not
    // take it (a run still holds the conversation), and the card stays to be sent again.
    onSent: (text: string) => boolean | void
    onSkip?: () => void
    className?: string
}

// A request for the Rerun team the coworker drafted: sent as is, edited first, or left. Nothing
// leaves before the click, and what leaves is the text as it stands on the card.
export function FeatureRequestBlock({ request, toolCallId, onSent, onSkip, className }: FeatureRequestBlockProps) {
    const t = useTranslations('chat.featureRequest')
    const tErrors = useTranslations('errors')
    const errorText = useErrorText()
    const conversation = useFeatureRequestConversation()
    const [editing, setEditing] = useState(false)
    const [sending, setSending] = useState(false)
    const [title, setTitle] = useState(request.title)
    const [description, setDescription] = useState(request.description)
    const { icon: KindIcon, tone } = KINDS[request.kind]
    const canSend = !!title.trim() && !!conversation?.sessionId && !sending

    async function send() {
        if (!conversation?.sessionId || !canSend) return
        setSending(true)
        const sent = { kind: request.kind, title: title.trim(), description: description.trim() }
        const result = await sendFeatureRequestAction({ sessionId: conversation.sessionId, scope: conversation.scope, toolCallId, ...sent, workaround: request.workaround }).catch(() => null)
        if (!result?.ok) {
            setSending(false)
            toast.error(result?.code ? errorText(result) : t('sendFailed'))
            return
        }
        // Sending again later writes the same row: the request is keyed on its call.
        if (onSent(serializeFeatureRequestSent(sent)) === false) {
            setSending(false)
            toast.error(tErrors('coworkerStillWorking'))
        }
    }

    // One line of title: Enter would only break it.
    function keepTitleOnOneLine(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key === 'Enter') event.preventDefault()
    }

    return (
        <div data-hitl-card="feature" className={cn('flex flex-col gap-3 p-4', PANEL_CARD, className)}>
            <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-medium break-words text-foreground">{title.trim() || request.title}</p>
                <Badge size="xs" tone={tone} glow={false} leading={<KindIcon className="size-3" />} className="shrink-0">
                    {t(`kinds.${request.kind}`)}
                </Badge>
            </div>
            {editing ? (
                <div className="flex flex-col gap-2">
                    <Textarea value={title} onChange={event => setTitle(event.target.value.replace(/\n/g, ' '))} onKeyDown={keepTitleOnOneLine} aria-label={t('titleLabel')} maxLength={FEATURE_REQUEST_LIMITS.title} rows={1} className="min-h-0 resize-none font-medium" />
                    <Textarea value={description} onChange={event => setDescription(event.target.value)} aria-label={t('descriptionLabel')} maxLength={FEATURE_REQUEST_LIMITS.description} rows={4} className="max-h-60 text-sm" />
                </div>
            ) : (
                description.trim() && <blockquote dir="auto" className="border-s-2 border-border ps-3 text-sm break-words whitespace-pre-line text-muted-foreground">{description}</blockquote>
            )}
            {request.workaround && (
                <div className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
                    <CompassIcon className="mt-px size-3.5 shrink-0" />
                    <span>{t.rich('today', { workaround: request.workaround, strong: chunks => <span className="font-medium text-foreground">{chunks}</span> })}</span>
                </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
                {onSkip && (
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onSkip} disabled={sending} data-hitl="skip">
                        {t('notNow')}
                    </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setEditing(current => !current)} disabled={sending} data-hitl="edit">
                    <PencilIcon className="size-3.5" />
                    {editing ? t('done') : t('edit')}
                </Button>
                <Button size="sm" onClick={() => void send()} disabled={!canSend} loading={sending} data-hitl="send">
                    {t('send')}
                </Button>
            </div>
        </div>
    )
}
