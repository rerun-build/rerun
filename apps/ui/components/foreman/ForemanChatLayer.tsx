'use client'

import type { UIMessage } from 'ai'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useScrollFade } from '@moldwright/ui/primitives'

import { Conversation, ConversationContent, ConversationScrollButton, type ConversationHandle } from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { ActionApprovalBlock } from '@/components/chat/ActionApprovalBlock'
import { mentionTokensOf } from '@/components/chat/MentionAutocomplete'
import { BudgetExhaustedNotice, usePriceArm } from '@moldwright/cloud/billing.client'
import { ChatActivityLoader } from '@/components/chat/ChatActivityLoader'
import { ProviderErrorNotice } from '@/components/chat/ProviderErrorNotice'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReadChatFile } from '@/components/chat/AttachmentLightbox'
import type { FileAccess } from '@/components/chat/FileCard'
import { useArriveByTop } from '@/hooks/useArriveByTop'
import type { ChatErrorKind } from '@/lib/chat-error'
import { hitlKindOf, pendingApprovals, serializeApprovalDecisions } from '@/lib/chat-hitl'
import { summarizePendingHitl } from '@/lib/chat/hitl-cue'
import { hitlCallBefore } from '@/lib/chat/hitl-receipts'
import type { MessageFeedbackRating } from '@moldwright/contracts'
import type { RawUrlFor } from '@/lib/files/raw-url'
import type { UploadTarget } from '@/lib/files/upload-url'
import { isEngineHitl, type PendingWidget } from '@/lib/foreman/pending-widget'
import type { ForemanNextStep } from '@/lib/foreman/next-steps'
import type { ForemanArrival } from '@/lib/foreman/phase'
import { isForemanWidgetTool } from '@/lib/foreman/tool-defs'
import { cn } from '@/lib/utils'
import { isLifetimePlan, isSubscriptionEntitled } from '@moldwright/cloud/billing'
import { useSession } from '@/supabase/session/SessionProvider'

import { isKickoffText, stripKickoff } from '@/lib/foreman/kickoff-marker'

import { ForemanTeamEmptyStateSlot } from './empty-state/ForemanTeamEmptyStateSlot'
import { ForemanNextSteps } from './ForemanNextSteps'
import { ForemanIntakeHeader } from './intake/ForemanIntakeHeader'
import type { ForemanIntakeController } from './intake/useForemanIntake'
import { FloatingMessage } from './FloatingMessage'
import { ForemanActivityIndicator } from './ForemanActivityIndicator'
import { useForemanMentionAgents } from './useForemanMentionAgents'
import { ForemanWelcome } from './ForemanWelcome'
import { EngineQuestionWidget } from './widgets/EngineQuestionWidget'
import { planAgentShortcuts } from './widgets/agent-picks'
import { renderForemanWidget, type AnswerWidget, type DismissWidget } from './widgets/renderForemanWidget'

const SCROLL_FADE = 56

type ForemanChatLayerProps = {
    messages: UIMessage[]
    streaming?: boolean
    guided?: boolean
    intake?: ForemanIntakeController | null
    gated?: boolean
    arrival?: ForemanArrival | null
    restored: boolean
    error?: { kind: ChatErrorKind; message: string } | null
    onWidgetAnswer?: AnswerWidget
    onWidgetDismiss?: DismissWidget
    pending?: PendingWidget | null
    answerAttachments?: { target: UploadTarget; maxFileSize: number } | null
    nextSteps?: ForemanNextStep[]
    onSuggestion?: (text: string) => void
    onPrefill?: (text: string) => void
    onStop?: () => void
    onStopTask?: (taskId: string) => void
    actions?: { onRegenerate: (messageId: string) => void; onRate: (messageId: string, rating: MessageFeedbackRating, messageText: string) => void; ratingOf: (messageId: string) => MessageFeedbackRating | null } | null
    rawUrlFor?: RawUrlFor
    readFile?: ReadChatFile
    sharedFiles?: FileAccess
    onStackElement?: (element: HTMLElement | null) => void
    className?: string
}

export function ForemanChatLayer({ messages, streaming, guided, intake, gated, arrival, restored, error, onWidgetAnswer, onWidgetDismiss, pending = null, answerAttachments = null, nextSteps, onSuggestion, onPrefill, onStop, onStopTask, actions, rawUrlFor, readFile, sharedFiles, onStackElement, className }: ForemanChatLayerProps) {
    const t = useTranslations('foreman.welcome')
    const tHitlCue = useTranslations('chat.hitlCue')
    const { workspace } = useSession()
    const priceArm = usePriceArm()
    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    const conversationRef = useRef<ConversationHandle | null>(null)
    const [scroller, setScroller] = useState<HTMLElement | null>(null)
    useEffect(() => {
        setScroller(conversationRef.current?.scrollRef.current ?? null)
        onStackElement?.(conversationRef.current?.contentRef.current ?? null)
    }, [onStackElement])
    const scrollMask = useScrollFade(scroller, { fadeSize: SCROLL_FADE })
    const mentionAgents = useForemanMentionAgents()
    const mentions = useMemo(() => mentionTokensOf(mentionAgents, []), [mentionAgents])
    const pendingRef = useArriveByTop(conversationRef, onWidgetAnswer && pending ? pending.toolCallId : null)
    const engineHitl = onWidgetAnswer && pending && isEngineHitl(pending.toolName) ? pending : null
    const engineHitlKind = engineHitl && hitlKindOf(engineHitl.toolName)
    const pendingCue = useMemo(
        () => (engineHitl && engineHitlKind ? { key: engineHitl.toolCallId, summary: summarizePendingHitl(engineHitlKind, (engineHitl.input ?? {}) as Record<string, unknown>, tHitlCue), blockRef: pendingRef } : null),
        [engineHitl, engineHitlKind, pendingRef, tHitlCue]
    )
    const renderToolPart = onWidgetAnswer
        ? (part: Parameters<typeof renderForemanWidget>[0]) => {
              if (part.toolCallId === engineHitl?.toolCallId) return null
              const widget = renderForemanWidget(part, onWidgetAnswer, onWidgetDismiss, shortcuts)
              if (!widget || !isForemanWidgetTool(part.toolName)) return widget
              return <div ref={part.toolCallId === pending?.toolCallId ? pendingRef : undefined}>{widget}</div>
          }
        : undefined
    const visible = messages.flatMap(message => {
        if (!message.parts.some(part => part.type === 'text' && isKickoffText((part as { text: string }).text))) return [message]
        const parts = message.parts.map(part => (part.type === 'text' ? { ...part, text: stripKickoff((part as { text: string }).text) } : part))
        const emptied = parts.every(part => part.type !== 'text' || !(part as { text: string }).text)
        return emptied ? [] : [{ ...message, parts } as UIMessage]
    })
    const shortcuts = planAgentShortcuts(visible)

    const empty = visible.length === 0 && !error
    const greeting = empty && guided && !intake
    const restoring = empty && !guided && !restored

    let notice: ReactNode = null
    if (error) {
        notice = (
            <Message from="assistant">
                <MessageContent>
                    {error.kind === 'budget' ? <BudgetExhaustedNotice preTrial={!entitled} trialing={workspace?.subscription_status === 'trialing'} paused={!!workspace?.rerun_credit_paused_at} lifetime={isLifetimePlan(workspace)} priceArm={priceArm} /> : <ProviderErrorNotice kind={error.kind} message={error.message} onStopRun={onStop} />}
                </MessageContent>
            </Message>
        )
    }

    return (
        <div className={cn('pointer-events-auto relative w-full', className)} style={{ contain: 'paint' }}>
            <AnimatePresence>
                {greeting &&
                    (gated ? (
                        <ForemanWelcome key="gate" title={t('gateTitle')} subtitle={t('gateSubtitle')} />
                    ) : (
                        <ForemanWelcome key="welcome" thinking={streaming} />
                    ))}
                {intake && <ForemanIntakeHeader key="intake" intake={intake} arrival={arrival} />}
            </AnimatePresence>

            <Conversation className="relative z-10 h-full" contextRef={conversationRef}>
                <div className="h-full" style={{ maskImage: scrollMask, WebkitMaskImage: scrollMask }}>
                    <ConversationContent
                        scrollClassName="max-md:flex max-md:flex-col md:[container-type:size]"
                        className={cn('justify-end gap-4 px-3 pb-5 max-md:mt-auto max-md:shrink-0 md:min-h-full', guided ? 'pt-12' : 'pt-24', intake || greeting ? 'max-md:min-h-72' : 'max-md:min-h-36')}
                    >
                        {restoring && <ForemanChatSkeleton />}
                        {empty && !greeting && !restoring && !intake ? (
                            <ForemanTeamEmptyStateSlot onSend={onSuggestion} onPrefill={onPrefill} />
                        ) : (
                            visible.map((message, index) => (
                                <FloatingMessage
                                    key={message.id}
                                    message={message}
                                    index={index}
                                    isActive={streaming && index === visible.length - 1}
                                    rawUrlFor={rawUrlFor}
                                    readFile={readFile}
                                    sharedFiles={sharedFiles}
                                    renderToolPart={renderToolPart}
                                    mentions={mentions}
                                    onStopTask={onStopTask}
                                    onRegenerate={engineHitl && index === visible.length - 1 ? undefined : actions?.onRegenerate}
                                    onRateMessage={actions?.onRate}
                                    feedbackRating={actions ? actions.ratingOf(message.id) : undefined}
                                    hitlCall={hitlCallBefore(visible, index)}
                                />
                            ))
                        )}
                        {engineHitl && onWidgetAnswer && (
                            <motion.div key={engineHitl.toolCallId} ref={pendingRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}>
                                {engineHitl.toolName === 'ask_user' ? (
                                    <EngineQuestionWidget
                                        input={engineHitl.input}
                                        target={answerAttachments?.target ?? null}
                                        maxFileSize={answerAttachments?.maxFileSize}
                                        onAnswer={text => onWidgetAnswer(engineHitl.toolName, engineHitl.toolCallId, text)}
                                        onDismiss={onWidgetDismiss && (() => onWidgetDismiss(engineHitl.toolCallId))}
                                    />
                                ) : (
                                    <ActionApprovalBlock inline approvals={pendingApprovals((engineHitl.input ?? {}) as Record<string, unknown>)} onSubmit={decisions => onWidgetAnswer(engineHitl.toolName, engineHitl.toolCallId, serializeApprovalDecisions(decisions))} />
                                )}
                            </motion.div>
                        )}
                        {nextSteps && nextSteps.length > 0 && !streaming && (
                            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}>
                                <ForemanNextSteps steps={nextSteps} />
                            </motion.div>
                        )}
                        {(streaming || (greeting && !gated)) && <ChatActivityLoader message={visible.at(-1)} indicator={<ForemanActivityIndicator />} />}
                        {notice}
                    </ConversationContent>
                </div>
                <ConversationScrollButton pending={pendingCue} />
            </Conversation>
        </div>
    )
}

function ForemanChatSkeleton() {
    return (
        <div aria-hidden className="flex flex-col gap-4">
            <SkeletonAssistantLines widths={['w-1/2', 'w-5/6', 'w-3/4']} />
            <div className="ml-auto flex w-fit max-w-[95%] flex-col gap-2 rounded-lg bg-secondary px-4 py-3">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3.5 w-24" />
            </div>
            <SkeletonAssistantLines widths={['w-2/3', 'w-4/5']} />
        </div>
    )
}

function SkeletonAssistantLines({ widths }: { widths: string[] }) {
    return (
        <div className="flex w-full flex-col gap-2">
            {widths.map(width => (
                <Skeleton key={width} className={cn('h-3.5', width)} />
            ))}
        </div>
    )
}
