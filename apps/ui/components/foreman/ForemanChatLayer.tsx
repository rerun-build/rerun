'use client'

import type { UIMessage } from 'ai'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useScrollFade } from '@rerun/ui/primitives'

import type { ThreadRow } from '@/app/api/_services/conversation.service'
import { ThreadBranch } from '@/components/agent/sheet/ThreadBranch'
import { Conversation, ConversationContent, ConversationScrollButton, type ConversationHandle } from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { mentionTokensOf } from '@/components/chat/MentionAutocomplete'
import { BudgetExhaustedNotice } from '@rerun/cloud/billing.client'
import { useWorkspaceManager } from '@/components/brand/useWorkspaceManager'
import { ChatActivityLoader } from '@/components/chat/ChatActivityLoader'
import { ChatScreen } from '@/components/chat/ChatScreen'
import { ProviderErrorNotice } from '@/components/chat/ProviderErrorNotice'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReadChatFile } from '@/components/chat/AttachmentLightbox'
import type { FileAccess } from '@/components/chat/FileCard'
import { useArriveByTop } from '@/hooks/useArriveByTop'
import { useMessageTimes } from '@/hooks/useMessageTimes'
import type { ChatErrorKind } from '@/lib/chat-error'
import { HITL_CANCELLED, hitlKindOf, pendingTakeover } from '@/lib/chat-hitl'
import { summarizePendingHitl } from '@/lib/chat/hitl-cue'
import { hitlCallBefore } from '@/lib/chat/hitl-receipts'
import { threadsByMessage } from '@/lib/chat/thread-rows'
import { FOREMAN_AGENT_ID, runUsesScreen, screenSite, type MessageFeedbackRating, type TableCard } from '@rerun/contracts'
import type { RawUrlFor } from '@/lib/files/raw-url'
import type { UploadTarget } from '@/lib/files/upload-url'
import { isEngineHitl, type PendingWidget } from '@/lib/foreman/pending-widget'
import type { ForemanNextStep } from '@/lib/foreman/next-steps'
import { isForemanWidgetTool } from '@/lib/foreman/tool-defs'
import { cn } from '@/lib/utils'
import { isClaudePlanOffered, isLifetimePlan, isSubscriptionEntitled } from '@rerun/cloud/billing'
import { useSession } from '@/supabase/session/SessionProvider'

import { isKickoffText, stripKickoff } from '@/lib/foreman/kickoff-marker'
import { useForemanName } from '@/hooks/useForemanName'

import { ForemanTeamEmptyStateSlot } from './empty-state/ForemanTeamEmptyStateSlot'
import { ForemanNextSteps } from './ForemanNextSteps'
import { FloatingMessage } from './FloatingMessage'
import { ForemanActivityIndicator } from './ForemanActivityIndicator'
import { useForemanMentionAgents } from './useForemanMentionAgents'
import { ForemanWelcome } from './ForemanWelcome'
import { EngineRequestBlock } from './widgets/EngineRequestBlock'
import { FeatureRequestConversationProvider } from '@/components/chat/feature-request/FeatureRequestConversation'
import { useForemanStore } from '@/stores/foreman.store'
import { planAgentShortcuts } from './widgets/agent-picks'
import { renderForemanWidget, type AnswerWidget, type DismissWidget } from './widgets/renderForemanWidget'
import { skillProposalRow, type ForemanSkillProposals } from './widgets/skill-proposal-row'

// De quoi laisser un message entier se dissoudre plutôt que d'en gommer la dernière ligne.
const SCROLL_FADE = 56

type ForemanChatLayerProps = {
    messages: UIMessage[]
    streaming?: boolean
    /** A run of its own is still held, whether or not this tab follows its stream yet: a reload reads the run before picking it up. */
    runHeld?: boolean
    /** Le tunnel d'onboarding, où c'est le Foreman qui parle le premier. */
    guided?: boolean
    /** La conversation du serveur est arrivée. Avant, une pile vide ne veut encore rien dire. */
    restored: boolean
    error?: { kind: ChatErrorKind; message: string } | null
    // What a widget answers with. Without it the widgets render read-only, which is what a
    // transcript replayed outside the live column needs.
    onWidgetAnswer?: AnswerWidget
    onWidgetDismiss?: DismissWidget
    // Its skill proposals, once its engine keeps skills of its own: a decided one is drawn where it
    // was raised.
    skillProposals?: ForemanSkillProposals
    // The widget the conversation is stopped on. An engine question is drawn after the last message;
    // any other one is already in the stack, inside the message that called it.
    pending?: PendingWidget | null
    /** Where a file joined to an engine question lands. Null when none could reach the foreman. */
    answerAttachments?: { target: UploadTarget; maxFileSize: number } | null
    // What a finished build leaves to press, drawn after the last message the way an engine question is.
    nextSteps?: ForemanNextStep[]
    onSuggestion?: (text: string) => void
    /** Writes into the composer without sending, for an empty-state action the user finishes typing. */
    onPrefill?: (text: string) => void
    onStop?: () => void
    /** Sends the failed turn's message again, offered on a transient error. */
    onRetry?: () => void
    /** Stops one delegated task of the run being streamed. Absent, the task shows no stop. */
    onStopTask?: (taskId: string) => void
    /** The row under an answer: copy, regenerate, thumbs. Only the foreman on the engine has it. */
    actions?: { onRegenerate: (messageId: string) => void; onRate?: (messageId: string, rating: MessageFeedbackRating, messageText: string) => void; ratingOf: (messageId: string) => MessageFeedbackRating | null } | null
    rawUrlFor?: RawUrlFor
    readFile?: ReadChatFile
    sharedFiles?: FileAccess
    /** Where a table it showed opens: its own card, or the workspace's knowledge base for a shared one. */
    onOpenTable?: (card: TableCard) => void
    /** General's threads, each under the message it was opened after. Only General has them. */
    threads?: ThreadRow[]
    onOpenThread?: (sessionId: string) => void
    /** A thread is on screen: the header carries the way back to General under its tabs. */
    underCrumb?: boolean
    /** Under a bar of its own (the Simple view's middle) rather than a header laid over it: the column a coworker's chat has. */
    framed?: boolean
    /** Ce qui porte la hauteur naturelle de la pile, que la sheet mobile mesure. */
    onStackElement?: (element: HTMLElement | null) => void
    /** The column is folded away: the welcome orb is out of sight and stops moving. */
    orbPaused?: boolean
    className?: string
}

/**
 * La pile de messages du panneau. Aucun fond à elle : la colonne est posée sur la gouttière, hors de
 * la carte du board, donc un voile translucide n'a rien à laisser voir. Il éclaircissait seulement la
 * gouttière en un rectangle aux bords nets, décalé de l'en-tête et du composer qui, eux, n'en ont pas.
 * Le défilement est celui du chat d'un agent : `Conversation` colle au bas et rend le même bouton de
 * retour en bas.
 */
export function ForemanChatLayer({ messages, streaming, runHeld = false, guided, restored, error, onWidgetAnswer, onWidgetDismiss, skillProposals, pending = null, answerAttachments = null, nextSteps, onSuggestion, onPrefill, onStop, onRetry, onStopTask, actions, rawUrlFor, readFile, sharedFiles, onOpenTable, threads, onOpenThread, underCrumb = false, framed = false, onStackElement, orbPaused, className }: ForemanChatLayerProps) {
    const tName = useTranslations('workspaceView.foreman')
    // A reply its message ends on is sent as the user's own message, word for word.
    const sendQuickReply = onSuggestion ? ({ text }: { text: string }) => onSuggestion(text) : undefined
    const foremanName = useForemanName()
    const tHitlCue = useTranslations('chat.hitlCue')
    const { workspace } = useSession()
    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    const manager = useWorkspaceManager()
    // `Conversation` possède son conteneur de défilement : on le récupère par son contexte, une
    // fois monté, pour que le fondu sache ce qu'il reste au-dessus et en dessous.
    const conversationRef = useRef<ConversationHandle | null>(null)
    const [scroller, setScroller] = useState<HTMLElement | null>(null)
    useEffect(() => {
        setScroller(conversationRef.current?.scrollRef.current ?? null)
        onStackElement?.(conversationRef.current?.contentRef.current ?? null)
    }, [onStackElement])
    const scrollMask = useScrollFade(scroller, { fadeSize: SCROLL_FADE })
    const mentionAgents = useForemanMentionAgents()
    const mentions = useMemo(() => mentionTokensOf(mentionAgents, []), [mentionAgents])
    const foremanConversationId = useForemanStore(state => state.sessionId)
    const featureRequestConversation = useMemo(() => ({ sessionId: foremanConversationId, scope: 'foreman' as const }), [foremanConversationId])
    const pendingRef = useArriveByTop(conversationRef, onWidgetAnswer && pending ? pending.toolCallId : null)
    const engineHitl = onWidgetAnswer && pending && isEngineHitl(pending.toolName) ? pending : null
    const engineHitlKind = engineHitl && hitlKindOf(engineHitl.toolName)
    const pendingCue = useMemo(
        () => (engineHitl && engineHitlKind ? { key: engineHitl.toolCallId, summary: summarizePendingHitl(engineHitlKind, (engineHitl.input ?? {}) as Record<string, unknown>, tHitlCue), blockRef: pendingRef } : null),
        [engineHitl, engineHitlKind, pendingRef, tHitlCue]
    )
    // Its screen, as in a coworker's chat: the live view stands in for the loader while the run works
    // on it, and a browser it hands over is that screen with the takeover on it.
    const takeoverAsk = engineHitl?.toolName === 'request_takeover' ? { callId: engineHitl.toolCallId, request: pendingTakeover((engineHitl.input ?? {}) as Record<string, unknown>) } : null
    const runOnScreen = useMemo(() => runUsesScreen(messages), [messages])
    const screenShown = (!!streaming && runOnScreen) || !!takeoverAsk
    const [root, setRoot] = useState<HTMLDivElement | null>(null)
    // `null` fait disparaître la part, `undefined` la rend à son étape d'outil normale : la question
    // de l'engine se dessine après le dernier message et sort donc de la pile. Le littéral compte :
    // un composant qui rend `null` laisserait, lui, un nœud vide dans la pile.
    // Un widget du hub garde la même enveloppe qu'il attende ou non : celle qui n'apparaîtrait qu'à
    // la fin du tour le remonterait, et la carte de plan rejouerait sa scène.
    const renderToolPart = onWidgetAnswer
        ? (part: Parameters<typeof renderForemanWidget>[0]) => {
              if (part.toolCallId === engineHitl?.toolCallId) return null
              if (part.toolName === 'skill_propose' && skillProposals) return skillProposalRow(part.output, skillProposals)
              const widget = renderForemanWidget(part, onWidgetAnswer, onWidgetDismiss, shortcuts)
              if (!widget || !isForemanWidgetTool(part.toolName)) return widget
              return <div ref={part.toolCallId === pending?.toolCallId ? pendingRef : undefined}>{widget}</div>
          }
        : undefined
    // Le message qui lance l'onboarding n'a pas été écrit par l'utilisateur : il ouvre le tour côté
    // modèle et n'a rien à faire dans la pile. Il porte pourtant parfois ce que l'utilisateur a
    // tapé sur la landing, et ça, ça doit se lire : on retire le marqueur au lieu de jeter le
    // message, et on ne jette que ce qu'il ne reste plus rien à afficher.
    const visible = messages.flatMap(message => {
        if (!message.parts.some(part => part.type === 'text' && isKickoffText((part as { text: string }).text))) return [message]
        const parts = message.parts.map(part => (part.type === 'text' ? { ...part, text: stripKickoff((part as { text: string }).text) } : part))
        const emptied = parts.every(part => part.type !== 'text' || !(part as { text: string }).text)
        return emptied ? [] : [{ ...message, parts } as UIMessage]
    })
    // Toutes les lignes de raccourci d'un message tiennent dans une seule carte, posée au premier appel.
    const shortcuts = planAgentShortcuts(visible)
    const messageTimes = useMessageTimes(visible)
    const threadRows = useMemo(() => threadsByMessage(messageTimes, threads ?? []), [messageTimes, threads])
    const threadOwner = useMemo(() => ({ agentId: FOREMAN_AGENT_ID, agentName: tName('name', foremanName) }), [tName, foremanName])
    const threadBranches = (rows: ThreadRow[] | undefined) => rows?.map(thread => <ThreadBranch key={thread.id} thread={thread} owner={threadOwner} onOpen={() => onOpenThread?.(thread.id)} />)

    // Une pile vide veut dire deux choses opposées, et elles ne se rendent pas pareil. En tunnel,
    // elle veut dire que le premier tour n'est pas encore revenu : proposer « What is running in my
    // workspace? » à quelqu'un qui n'a pas de workspace, et le laisser cliquer par-dessus
    // l'onboarding en cours, est un faux départ, donc c'est l'orbe qui tient l'écran. Ailleurs elle
    // veut dire que la conversation du serveur est encore en vol, et ça se dit avec la forme de ce
    // qui va arriver.
    // A General nobody spoke in yet, whose threads were all opened from « New conversation », shows them.
    const empty = visible.length === 0 && !error && threadRows.leading.length === 0
    const greeting = empty && guided
    const restoring = empty && !guided && !restored
    const activityLoader = streaming || greeting ? <ChatActivityLoader message={visible.at(-1)} indicator={<ForemanActivityIndicator />} /> : null

    let notice: ReactNode = null
    if (error) {
        notice = (
            <Message from="assistant">
                <MessageContent>
                    {/* Pas de cellule « abonnement » : il n'y a pas de Box derrière le Foreman, donc
                        nulle part où brancher un plan Claude ou ChatGPT. */}
                    {error.kind === 'budget' ? <BudgetExhaustedNotice preTrial={!entitled} trialing={workspace?.subscription_status === 'trialing'} paused={!!workspace?.rerun_credit_paused_at} lifetime={isLifetimePlan(workspace)} claudePlanOffered={isClaudePlanOffered(workspace)} manager={manager} /> : <ProviderErrorNotice kind={error.kind} message={error.message} onStopRun={onStop} onRetry={onRetry} />}
                </MessageContent>
            </Message>
        )
    }

    return (
        <FeatureRequestConversationProvider value={featureRequestConversation}>
            <div ref={setRoot} className={cn('pointer-events-auto relative w-full', className)} style={{ contain: 'paint' }}>
                {/* Posé par-dessus la pile plutôt que dedans : il la trouve vide, et en sortant il se
                    fond sur le premier message qui arrive au lieu de lui disputer la hauteur. */}
                <AnimatePresence>
                    {greeting && <ForemanWelcome key="welcome" thinking={streaming} orbPaused={orbPaused} />}
                </AnimatePresence>

                <Conversation className="relative z-10 h-full" contextRef={conversationRef}>
                    {/* Le fondu porte sur ce calque et pas sur la `Conversation` : le bouton de retour
                        en bas est son frère, ancré au ras du bord où le fondu est le plus fort, et il
                        doit rester net. Le calque ne défile pas, il couvre exactement la fenêtre du
                        conteneur qui défile, donc le fondu reste collé aux bords du panneau. */}
                    <div className="h-full" style={{ maskImage: scrollMask, WebkitMaskImage: scrollMask }}>
                        {/* `justify-end` et `min-h-full` : une conversation de deux messages reste collée
                            au composer au lieu de flotter en haut du panneau. Sous `md` la sheet mesure
                            cette pile pour prendre sa hauteur, un `min-h-full` l'empêcherait de jamais
                            redescendre : c'est `mt-auto` qui la colle au composer, et il cède au
                            défilement quand la pile déborde. L'accueil et l'en-tête de la carte sont
                            posés en overlay, sans hauteur à eux : le plancher leur garde la place. Ce
                            plancher explicite rend la pile compressible par le scroller, et la sheet
                            qui la mesure rétrécirait d'un pixel à chaque tour : `shrink-0` l'en garde. */}
                        <ConversationContent
                            scrollClassName="max-md:flex max-md:flex-col md:[container-type:size]"
                            className={cn(
                                framed ? 'mx-auto w-full max-w-[var(--chat-column,none)]' : cn('justify-end gap-4 px-3 pb-5 max-md:mt-auto max-md:shrink-0 md:min-h-full', guided ? 'pt-12' : underCrumb ? 'pt-[8.5rem]' : 'pt-24'),
                                greeting ? 'max-md:min-h-72' : 'max-md:min-h-36'
                            )}
                        >
                            {restoring && <ForemanChatSkeleton still={orbPaused} />}
                            {threadBranches(threadRows.leading)}
                            {empty && !greeting && !restoring ? (
                                <ForemanTeamEmptyStateSlot onSend={onSuggestion} onPrefill={onPrefill} orbPaused={orbPaused} />
                            ) : (
                                visible.flatMap((message, index) => [
                                    <FloatingMessage
                                        key={message.id}
                                        message={message}
                                        index={index}
                                        isActive={streaming && index === visible.length - 1}
                                        settled={index < visible.length - 1 || !(streaming || runHeld)}
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
                                        showQuickReplies={index === visible.length - 1 && !streaming && !engineHitl && !nextSteps?.length}
                                        onSendMessage={sendQuickReply}
                                        onDraftReply={onPrefill}
                                        onOpenTable={onOpenTable}
                                    />,
                                    ...(threadBranches(threadRows.after.get(index)) ?? []),
                                ])
                            )}
                            {engineHitl && onWidgetAnswer && !takeoverAsk && (
                                <motion.div key={engineHitl.toolCallId} ref={pendingRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}>
                                    <EngineRequestBlock request={engineHitl} answerAttachments={answerAttachments} onAnswer={text => onWidgetAnswer(engineHitl.toolName, engineHitl.toolCallId, text)} onDismiss={onWidgetDismiss && (() => onWidgetDismiss(engineHitl.toolCallId))} />
                                </motion.div>
                            )}
                            {nextSteps && nextSteps.length > 0 && !streaming && (
                                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}>
                                    <ForemanNextSteps steps={nextSteps} />
                                </motion.div>
                            )}
                            {/* Pendant l'accueil, le premier tour n'est souvent pas encore parti (le
                                workspace se prépare) : le loader se montre quand même, sinon l'écran a
                                l'air figé jusqu'au premier token. */}
                            {screenShown && onWidgetAnswer ? (
                                <ChatScreen
                                    agentId={FOREMAN_AGENT_ID}
                                    active={!orbPaused}
                                    site={screenSite(messages, takeoverAsk?.request.url ?? null)}
                                    takeoverAsk={takeoverAsk}
                                    onTakeoverDone={summary => takeoverAsk && onWidgetAnswer(engineHitl?.toolName ?? 'request_takeover', takeoverAsk.callId, summary)}
                                    onTakeoverSkip={() => takeoverAsk && onWidgetAnswer(engineHitl?.toolName ?? 'request_takeover', takeoverAsk.callId, HITL_CANCELLED.takeover)}
                                    scroller={scroller}
                                    floatingHost={root}
                                    arriveRef={takeoverAsk ? pendingRef : undefined}
                                    fallback={activityLoader}
                                />
                            ) : (
                                activityLoader
                            )}
                            {notice}
                        </ConversationContent>
                    </div>
                    <ConversationScrollButton pending={pendingCue} />
                </Conversation>
            </div>
        </FeatureRequestConversationProvider>
    )
}

/**
 * Ce qui tient la pile pendant qu'on va chercher la conversation sur le hub. Posé dans le flux et
 * non en overlay : la pile est collée au composer, donc les bulles fantômes occupent exactement la
 * place où le transcript va atterrir, et rien ne saute à son arrivée. Il se démonte d'un coup,
 * l'entrée en fondu de `FloatingMessage` porte le relais.
 */
function ForemanChatSkeleton({ still }: { still?: boolean }) {
    return (
        <div aria-hidden className={cn('flex flex-col gap-4', still && '[&_[data-slot=skeleton]]:animate-none')}>
            <SkeletonAssistantLines widths={['w-1/2', 'w-5/6', 'w-3/4']} />
            <div className="ms-auto flex w-fit max-w-[95%] flex-col gap-2 rounded-lg bg-secondary px-4 py-3">
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
