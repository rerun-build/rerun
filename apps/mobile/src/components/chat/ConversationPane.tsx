import { RERUN_CONNECTION_ID, appendAttachmentsRef, threadsByMessage, authorIdOf, runUsesScreen, scrollCueOf, screenSite, shouldFlush, shouldKeepQueued, buildAttachmentsRef, findPendingAlert, findPendingHitl, findUnknownPendingCall, needsHuman, paidDataSourcesByTurn, pendingTakeover, quickRepliesOf, quickReplyDraft, type AgentModels, type AgentView, type SessionStatus } from '@rerun/contracts'
import { router, useFocusEffect } from 'expo-router'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native'
import Animated, { FadeInDown, FadeOutDown, LayoutAnimationConfig, SlideInDown, SlideOutDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { acknowledgeAlert, cancelSubRun } from '@/api/chat'
import { runningModel } from '@/api/models'
import { transcribeRecording, uploadChatFile, uploadVoiceRecording } from '@/api/uploads'
import { useAuth } from '@/auth/AuthProvider'
import { setPendingDesktopOpen } from '@/desktop/pending-open'
import { track } from '@/lib/analytics'
import * as Haptics from '@/lib/haptics'
import { askForPushOnce, setConversationOnScreen } from '@/notifications/push'
import type { ChatEndpoints } from '@/chat/endpoints'
import { useCoworkerChat } from '@/chat/useCoworkerChat'
import { useMessageTimes } from '@/chat/useMessageTimes'
import { useMessageFeedback } from '@/chat/useMessageFeedback'
import { setDraft, useDraft } from '@/chat/composer-drafts'
import { useQueuedMessage } from '@/chat/useQueuedMessage'
import { useSkillProposals } from '@/chat/useSkillProposals'
import { cachedBoard } from '@/data/local-cache'
import { useCoworkerSkills } from '@/data/useCoworkerSkills'
import { useMemberProfiles } from '@/data/useMemberProfiles'
import { useWorkspaceAgents } from '@/data/useWorkspaceAgents'
import { CHAT_COLUMN_MAX_WIDTH } from '@/components/layout/split'
import { connectHref } from '@/components/providers/routes'
import { AppText } from '@/components/ui/AppText'
import { moodOf } from '@/components/ui/CoworkerAvatar'
import { PillButton } from '@/components/ui/PillButton'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import { uploadAttachments, type ComposerAttachment } from './attachments'
import { PinnedSkillProposal } from './cards/SkillProposalRow'
import { CHAT_HEADER_HEIGHT } from './ChatHeader'
import { Composer, type ComposerHandle } from './Composer'
import { ErrorCard, type ErrorCardActions } from './ErrorCard'
import { ConversationSkeleton } from './ConversationSkeleton'
import { CoworkerEmptyState, ForemanEmptyState } from './EmptyStates'
import { StartedByBanner, type StartedBy } from './origins/StartedByBanner'
import type { VoiceSender } from './useVoiceMessage'
import { AlertWidget } from './hitl/AlertWidget'
import { HitlBlock, UnknownCallBlock } from './hitl/HitlBlock'
import { PendingHitlPill } from './hitl/PendingHitlPill'
import { QueuedMessagePill } from './QueuedMessagePill'
import { RISE_IN, ScrollToEndButton, SINK_OUT } from './ScrollToEndButton'
import { widgetFor } from './hitl/registry'
import { HITL_WIDGETS } from './hitl/widgets'
import { mentionAgentsOf } from './mentions'
import { MessageView } from './MessageView'
import { runPhase, stepGroupShowsActivity } from './run-phase'
import { RunStatus } from './RunStatus'
import { ChatScreen } from './screen/ChatScreen'
import { seenInThread } from './screen/seen-in-thread'
import { FloatingScreen, ScreenMirror } from './screen/FloatingScreen'
import { useAgentScreen } from './screen/useAgentScreen'
import { useTakeoverRequest } from './screen/useTakeoverRequest'
import { Suggestions } from './Suggestions'
import type { ThreadItem } from './threads/general-threads'
import { ThreadBranch } from './threads/ThreadBranch'
import { TimedTurns } from './TimedTurns'
import { useKeyboardShown } from './useKeyboardShown'

export const BLUR_ABOVE_FOOTER = 32
const AT_BOTTOM = 24
const SEEN_BAND = 24

export type ChatCoworker = { id: string; kind: 'coworker' | 'foreman'; name: string; role: string; status: AgentView['agent']['status'] }

type ConversationPaneProps = {
    coworker: ChatCoworker
    makeEndpoints: () => ChatEndpoints
    initialSessionId: string | null
    onSessionCreated: (sessionId: string) => void
    models: AgentModels | null
    status: SessionStatus | null
    onStatusChange: () => void
    webUrl: string
    onScreen?: boolean
    startedBy?: StartedBy | null
    initialMessage?: string
    canAttach?: boolean
    threads?: ThreadItem[]
    onOpenThread?: (sessionId: string) => void
}

export function ConversationPane({ coworker, makeEndpoints, initialSessionId, onSessionCreated, models, status, onStatusChange, webUrl, onScreen = true, startedBy = null, initialMessage, canAttach = true, threads, onOpenThread }: ConversationPaneProps) {
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const insets = useSafeAreaInsets()
    const t = useTranslations('mobileChat.pane')
    const tc = useTranslations('mobileCommon.errors')
    const scroll = useRef<ScrollViewInstance>(null)
    const shownTranscript = useRef(false)
    const [endpoints] = useState(makeEndpoints)
    const enqueueRef = useRef<(text: string, behindRunId: string | null) => void>(() => {})
    const chat = useCoworkerChat({ endpoints, initialSessionId, onSessionCreated, onRefused: (text, behindRunId) => enqueueRef.current(text, behindRunId) })
    const conversationKey = `${coworker.id}-${chat.sessionId ?? 'new'}`
    const queue = useQueuedMessage(conversationKey)
    const proposals = useSkillProposals(coworker.kind === 'coworker' ? chat.sessionId : null, chat.busy)
    const skillProposals = { ...proposals, decide: (proposalId: string, decision: 'accept' | 'dismiss') => proposals.decide(proposalId, decision).then(onStatusChange) }
    const feedback = useMessageFeedback(chat.sessionId, coworker.kind === 'foreman' ? 'foreman' : 'agent')
    useLayoutEffect(() => {
        enqueueRef.current = queue.enqueue
    }, [queue.enqueue])
    const [stopping, setStopping] = useState(false)
    const draft = useDraft(conversationKey)
    const composer = useRef<ComposerHandle>(null)
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
    const [uploading, setUploading] = useState(false)
    const [belowFold, setBelowFold] = useState(0)
    const stuck = useRef(true)
    const [following, setFollowing] = useState(true)
    const stick = (value: boolean) => {
        if (stuck.current === value) return
        stuck.current = value
        setFollowing(value)
    }
    const touching = useRef(false)
    const metrics = useRef({ content: 0, viewport: 0 })
    const [blockHeight, setBlockHeight] = useState(0)
    const [scrollTop, setScrollTop] = useState(0)
    const [viewport, setViewport] = useState(0)
    const [threadTop, setThreadTop] = useState(0)
    const [screenBox, setScreenBox] = useState<{ y: number; height: number } | null>(null)
    const [focused, setFocused] = useState(true)
    useFocusEffect(
        useCallback(() => {
            setFocused(true)
            return () => setFocused(false)
        }, [])
    )
    const [footerHeight, setFooterHeight] = useState(0)

    const keyboard = useAnimatedKeyboard()
    const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value + spacing.sm, insets.bottom) }))

    const lastAssistant = chat.messages.findLastIndex(message => message.role === 'assistant')
    const messageTimes = useMessageTimes(chat.messages)
    const threadRows = useMemo(() => threadsByMessage(messageTimes, threads ?? []), [messageTimes, threads])
    const threadBranches = (rows: ThreadItem[] | undefined) => rows?.map(thread => <ThreadBranch key={thread.id} thread={thread} onOpen={() => onOpenThread?.(thread.id)} />)
    const authorIds = coworker.kind === 'foreman' ? [] : [...new Set(chat.messages.flatMap(message => authorIdOf(message) ?? []))]
    const profileOf = useMemberProfiles(authorIds)
    const [dismissedCallId, setDismissedCallId] = useState<string | null>(null)
    const settled = chat.fresh && !chat.busy && !chat.error
    const pending = !settled || status === 'idle' ? null : findPendingHitl(chat.messages, dismissedCallId)
    const replacesComposer = pending !== null && widgetFor(pending, HITL_WIDGETS) !== null
    const blockOutOfSight = pending !== null && blockHeight > 0 && belowFold > blockHeight
    const [acknowledged, setAcknowledged] = useState<string | null>(null)
    const waitingOnHuman = status !== null && status !== 'error' && needsHuman(status)
    const pendingAlert = status === 'awaiting_ack' && settled ? findPendingAlert(chat.messages) : null
    const alert = pendingAlert && (pendingAlert.toolCallId ?? pendingAlert.message) !== acknowledged ? pendingAlert : null
    const unknownCall = pending || alert || !settled || !waitingOnHuman ? null : findUnknownPendingCall(chat.messages)
    const replies = !settled || pending || unknownCall || lastAssistant < 0 || lastAssistant !== chat.messages.length - 1 ? [] : quickRepliesOf(chat.messages[lastAssistant])
    const empty = chat.history === 'ready' && chat.messages.length === 0 && !chat.busy && threadRows.leading.length === 0
    const takeoverPending = pending?.kind === 'takeover' && replacesComposer ? pending : null
    const runOnScreen = useMemo(() => runUsesScreen(chat.messages), [chat.messages])
    const paidSourcesByTurn = useMemo(() => paidDataSourcesByTurn(chat.messages), [chat.messages])
    const screenShown = coworker.kind === 'coworker' && chat.history === 'ready' && ((chat.busy && runOnScreen) || !!takeoverPending)
    const screen = useAgentScreen(coworker.id, screenShown && onScreen && focused)
    const screenUnavailable = screen.status === 'error' || screen.status === 'disconnected'
    const screenInThread = screenShown && (!screenUnavailable || !!takeoverPending)
    const visibleTop = scrollTop + insets.top + CHAT_HEADER_HEIGHT + SEEN_BAND
    const visibleBottom = scrollTop + viewport - footerHeight
    const screenSeen = !screenBox || seenInThread({ top: threadTop + screenBox.y, bottom: threadTop + screenBox.y + screenBox.height }, { top: visibleTop, bottom: visibleBottom })
    const floatingShown = screenInThread && screen.status === 'live' && !screenSeen && focused
    const { mirror } = screen
    useEffect(() => mirror(floatingShown), [mirror, floatingShown])
    const phase = runPhase(chat.status, chat.messages.at(-1))

    const sessionId = chat.sessionId
    useEffect(() => {
        if (!onScreen) return
        setConversationOnScreen(sessionId)
        return () => setConversationOnScreen(null)
    }, [sessionId, onScreen])

    useKeyboardShown(() => stuck.current && scroll.current?.scrollToEnd({ animated: true }))

    const followEnd = () => {
        stick(true)
        scroll.current?.scrollToEnd({ animated: true })
    }
    const send = (text: string, files?: Parameters<typeof chat.send>[1]) => {
        stick(true)
        if (chat.busy) {
            queue.enqueue(text, chat.activeRunId())
            return
        }
        return chat.send(text, files)
    }

    const takeover = useTakeoverRequest(coworker.id, coworker.name, takeoverPending, text => send(text))
    const takeControl = () => {
        if (takeover) return takeover.onOpen()
        setPendingDesktopOpen({ agentId: coworker.id, name: coworker.name })
        router.push({ pathname: '/desktop', params: { agent: coworker.id } })
    }

    const canFlush = shouldFlush({ queued: queue.queued, busy: chat.busy || stopping, uploading, status: chat.status, hasError: !!chat.error })
    const flushing = useRef<string | null>(null)
    useEffect(() => {
        if (!canFlush || !queue.queued || flushing.current === queue.queued.id) return
        flushing.current = queue.queued.id
        stick(true)
        chat.send(queue.queued.text, undefined, { queued: true })
        queue.clear()
    }, [canFlush, queue, chat])

    const restored = queue.queued && queue.queued.id === queue.restoredId ? queue.queued : null
    useEffect(() => {
        if (!restored || !chat.fresh || chat.busy || status === 'working') return
        if (shouldKeepQueued(restored, chat.activeRunId())) return
        queue.returnToComposer(conversationKey)
    }, [restored, chat, status, queue, conversationKey])

    const askedRef = useRef(false)
    useEffect(() => {
        if (!initialMessage || askedRef.current || initialSessionId || chat.history !== 'ready') return
        askedRef.current = true
        send(initialMessage)
    })

    const sendQueuedNow = async () => {
        setStopping(true)
        await chat.stop()
        setStopping(false)
    }

    const jumpToPending = () => {
        const top = insets.top + CHAT_HEADER_HEIGHT + spacing.sm
        const room = metrics.current.viewport - top - footerHeight
        if (blockHeight <= room) return followEnd()
        stick(false)
        const blockBottom = metrics.current.content - footerHeight - BLUR_ABOVE_FOOTER
        scroll.current?.scrollTo({ y: Math.max(0, blockBottom - blockHeight - top), animated: true })
    }
    const cue = scrollCueOf({ pending: pending !== null, pendingInView: !blockOutOfSight, atBottom: following || belowFold <= AT_BOTTOM })

    const pickReply = (reply: string) => {
        const draftReply = quickReplyDraft(reply)
        if (!draftReply) return void submit(reply)
        setDraft(conversationKey, draftReply)
        composer.current?.focus()
    }

    const submit = async (text: string) => {
        const message = text.trim()
        if (!message && attachments.length === 0) return
        const key = conversationKey
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        if (caller) askForPushOnce(caller).catch(() => {})
        if (attachments.length === 0 || !caller) {
            setDraft(key, '')
            send(message)
            return
        }
        setUploading(true)
        try {
            const { paths, files } = await uploadAttachments(caller, coworker.id, attachments)
            setDraft(key, '')
            setAttachments([])
            send(appendAttachmentsRef(message, buildAttachmentsRef(paths)), files)
        } catch {
            Alert.alert(t('attachFailed'), tc('tryAgainShortly'))
        } finally {
            setUploading(false)
        }
    }

    const voice: VoiceSender | undefined = caller
        ? {
              upload: uri => uploadVoiceRecording(caller, endpoints.fileOwner(chat.sessionId), uri),
              transcribe: uri => transcribeRecording(caller, uri),
              send: async text => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  askForPushOnce(caller).catch(() => {})
                  if (attachments.length === 0) {
                      send(text)
                      return
                  }
                  const { paths, files } = await uploadAttachments(caller, coworker.id, attachments)
                  setAttachments([])
                  send(appendAttachmentsRef(text, buildAttachmentsRef(paths)), files)
              },
          }
        : undefined

    const chip = runningModel(models)
    const model = chip && !models?.pinned ? { ...chip, label: t('defaultModel', { model: chip.label }) } : chip

    const isForeman = coworker.kind === 'foreman'
    const skills = useCoworkerSkills(isForeman ? null : coworker.id)
    const workspaceAgents = useWorkspaceAgents()
    const boxes = me ? (cachedBoard(me.workspace.id).read()?.boxes ?? []) : []
    const mentionAgents = workspaceAgents ? mentionAgentsOf(workspaceAgents, boxes, isForeman ? null : coworker.id) : []
    const runsOn = models?.resolved?.connectionId ?? models?.boxDefault?.connectionId
    const openModel = () => router.push({ pathname: '/model', params: { agent: coworker.id } })
    const errorActions: Omit<ErrorCardActions, 'onRetry'> = {
        onReconnect: () => {
            track('connection_cta_clicked', { source: 'ios_chat_error' })
            router.push(runsOn && runsOn !== RERUN_CONNECTION_ID ? { pathname: '/providers/[id]', params: { id: runsOn } } : '/providers')
        },
        onSwitchModel: openModel,
        onConnect: provider => {
            track('connection_cta_clicked', { source: `ios_budget_notice_${provider}` })
            router.push(connectHref(provider))
        },
    }
    const stopTask = (taskId: string) => {
        const runId = chat.activeRunId()
        if (caller && runId) cancelSubRun(caller, coworker.id, runId, taskId).catch(() => Alert.alert(t('stopTaskFailed'), tc('tryAgainShortly')))
    }
    const placeholder = pending || unknownCall ? t('answerPlaceholder', { name: coworker.name }) : !chat.sessionId ? t('newPlaceholder') : isForeman ? t('foremanPlaceholder') : t('messagePlaceholder', { name: coworker.name })

    return (
        <Animated.View style={[{ flex: 1 }, lift]}>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                <ScrollView
                    ref={scroll}
                    style={StyleSheet.absoluteFill}
                    scrollIndicatorInsets={{ bottom: footerHeight }}
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    scrollEventThrottle={64}
                    onScroll={({ nativeEvent: { contentSize, contentOffset, layoutMeasurement } }) => {
                        const below = Math.max(0, contentSize.height - contentOffset.y - layoutMeasurement.height - BLUR_ABOVE_FOOTER)
                        metrics.current = { content: contentSize.height, viewport: layoutMeasurement.height }
                        setBelowFold(below)
                        if (screenInThread) {
                            setScrollTop(contentOffset.y)
                            setViewport(layoutMeasurement.height)
                        }
                        if (touching.current) stick(below <= AT_BOTTOM)
                    }}
                    onScrollBeginDrag={() => {
                        touching.current = true
                    }}
                    onScrollEndDrag={({ nativeEvent: { velocity } }) => {
                        if (!velocity?.y) touching.current = false
                    }}
                    onMomentumScrollEnd={() => {
                        touching.current = false
                    }}
                    onLayout={event => {
                        metrics.current = { ...metrics.current, viewport: event.nativeEvent.layout.height }
                        setViewport(event.nativeEvent.layout.height)
                    }}
                    onContentSizeChange={(_, height) => {
                        metrics.current = { ...metrics.current, content: height }
                        if (stuck.current) scroll.current?.scrollToEnd({ animated: shownTranscript.current })
                        if (chat.history === 'ready') shownTranscript.current = true
                    }}
                    contentContainerStyle={{ flexGrow: 1, justifyContent: empty ? 'center' : 'flex-end', width: '100%', maxWidth: CHAT_COLUMN_MAX_WIDTH, alignSelf: 'center', paddingTop: insets.top + CHAT_HEADER_HEIGHT + spacing.lg, paddingBottom: footerHeight + BLUR_ABOVE_FOOTER, paddingHorizontal: spacing.xl - 4 }}
                >
                    {chat.history === 'loading' && <ConversationSkeleton />}
                    {chat.history === 'error' && (
                        <View style={{ alignItems: 'center', gap: spacing.md }}>
                            <AppText variant="callout" tone="muted">
                                {t('loadFailed')}
                            </AppText>
                            <PillButton label={t('retry')} variant="secondary" onPress={chat.retry} />
                        </View>
                    )}
                    {empty && (isForeman ? <ForemanEmptyState onSend={submit} onPrefill={text => setDraft(conversationKey, text)} /> : <CoworkerEmptyState agentId={coworker.id} mood={moodOf(coworker.status)} asleep={coworker.status === 'offline'} onSend={submit} />)}
                    {chat.history === 'ready' && !empty && (
                        <LayoutAnimationConfig skipEntering={!chat.busy}>
                            <View style={{ gap: spacing.xl }} onLayout={event => setThreadTop(event.nativeEvent.layout.y)}>
                                {startedBy && <StartedByBanner startedBy={startedBy} />}
                                {threadBranches(threadRows.leading)}
                                <TimedTurns
                                    messages={chat.messages}
                                    authorOf={authorId => (isForeman ? undefined : profileOf(authorId))}
                                    renderMessage={(message, index, stamp) => (
                                        <Fragment key={message.id}>
                                            <MessageView message={message} isLastAssistant={index === lastAssistant} running={chat.busy} agentId={isForeman ? null : coworker.id} fileOwner={endpoints.fileOwner(chat.sessionId)} coworkerName={coworker.name} hiddenCallId={alert?.toolCallId ?? null} skillProposals={skillProposals} onStopTask={stopTask} onRegenerate={pending ? undefined : () => void chat.regenerate()} feedback={feedback} stamp={stamp} paidSources={paidSourcesByTurn.get(message.id)} />
                                            {threadBranches(threadRows.after.get(index))}
                                        </Fragment>
                                    )}
                                />
                                {pending && !takeoverPending && (
                                    <Animated.View key={pending.toolCallId} entering={FadeInDown.duration(280)} onLayout={event => setBlockHeight(event.nativeEvent.layout.height)}>
                                        <HitlBlock
                                            pending={pending}
                                            agentId={coworker.id}
                                            coworkerName={coworker.name}
                                            webUrl={webUrl}
                                            upload={canAttach && caller ? attachment => uploadChatFile(caller, coworker.id, attachment.uri, attachment.name) : undefined}
                                            transcribe={caller ? uri => transcribeRecording(caller, uri) : undefined}
                                            onAnswer={text => send(text)}
                                            onDismiss={() => {
                                                setDismissedCallId(pending.toolCallId)
                                                chat.stop()
                                            }}
                                        />
                                    </Animated.View>
                                )}
                                {screenInThread && (
                                    <Animated.View
                                        entering={FadeInDown.duration(280)}
                                        onLayout={event => {
                                            const { y, height } = event.nativeEvent.layout
                                            setScreenBox({ y, height })
                                            if (takeoverPending) setBlockHeight(height)
                                        }}
                                    >
                                        <ChatScreen status={screen.status} uri={screen.uri} onMessage={screen.onMessage} attachWebView={screen.attachWebView} site={screenSite(chat.messages, takeoverPending ? (pendingTakeover(takeoverPending.input).url ?? null) : null)} takeover={takeover} onTakeControl={takeControl} />
                                    </Animated.View>
                                )}
                                {unknownCall && <UnknownCallBlock call={unknownCall} coworkerName={coworker.name} webUrl={webUrl} />}
                                {chat.error && <ErrorCard message={chat.error.message} onRetry={chat.regenerate} {...errorActions} />}
                                {chat.busy && !screenInThread && !stepGroupShowsActivity(chat.messages.at(-1)) && <RunStatus coworker={coworker} phase={phase} />}
                            </View>
                        </LayoutAnimationConfig>
                    )}
                </ScrollView>
                {floatingShown && (
                    <FloatingScreen top={insets.top + CHAT_HEADER_HEIGHT + spacing.xs} label={takeover ? t('openBrowser') : t('takeControl')} onTakeControl={takeControl}>
                        <ScreenMirror frames={screen.frames} />
                    </FloatingScreen>
                )}
                {cue === 'pill' && pending && (
                    <Animated.View key="pill" entering={RISE_IN} exiting={SINK_OUT} style={{ position: 'absolute', bottom: footerHeight + spacing.md, left: spacing.lg, right: spacing.lg, alignItems: 'center' }} pointerEvents="box-none">
                        <PendingHitlPill kind={pending.kind} input={pending.input} onJump={jumpToPending} />
                    </Animated.View>
                )}
                {cue === 'arrow' && !chat.error && chat.history === 'ready' && (
                    <Animated.View key="arrow" entering={RISE_IN} exiting={SINK_OUT} style={{ position: 'absolute', bottom: footerHeight + spacing.md, left: 0, right: 0, alignItems: 'center' }} pointerEvents="box-none">
                        <ScrollToEndButton onPress={followEnd} />
                    </Animated.View>
                )}

                <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ gap: spacing.md, width: '100%', maxWidth: CHAT_COLUMN_MAX_WIDTH, alignSelf: 'center', paddingTop: replacesComposer && !alert ? 0 : spacing.sm }}>
                    {alert && (
                        <Animated.View entering={FadeInDown.duration(280)} exiting={FadeOutDown.duration(280)} style={{ paddingHorizontal: spacing.md }}>
                            <AlertWidget
                                message={alert.message}
                                onAcknowledge={async () => {
                                    if (!caller || !chat.sessionId) return
                                    await acknowledgeAlert(caller, chat.sessionId)
                                    setAcknowledged(alert.toolCallId ?? alert.message)
                                    onStatusChange()
                                }}
                            />
                        </Animated.View>
                    )}
                    {skillProposals.pinned.map(proposal => (
                        <Animated.View key={proposal.id} entering={FadeInDown.duration(280)} exiting={FadeOutDown.duration(280)} style={{ paddingHorizontal: spacing.md }}>
                            <PinnedSkillProposal proposal={proposal} pending={skillProposals.pendingId === proposal.id} onDecide={skillProposals.decide} />
                        </Animated.View>
                    ))}
                    {replies.length > 0 && !draft && !queue.queued && <Suggestions items={replies} onPick={pickReply} />}
                    {queue.queued && (
                        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(200)} style={{ paddingHorizontal: spacing.md }}>
                            <QueuedMessagePill text={queue.queued.text} busy={chat.busy} pending={stopping} onSendNow={sendQueuedNow} onDiscard={queue.clear} />
                        </Animated.View>
                    )}
                    <LayoutAnimationConfig skipEntering>
                        {!replacesComposer && (
                            <Animated.View entering={SlideInDown.duration(280)} exiting={SlideOutDown.duration(280)} style={{ paddingHorizontal: spacing.md }}>
                                <Composer ref={composer} draftKey={conversationKey} attachments={attachments} onAttachmentsChange={setAttachments} skills={skills} mentionAgents={mentionAgents} onSend={() => submit(draft)} onStop={chat.stop} running={chat.busy || uploading} placeholder={placeholder} model={model} onOpenModel={openModel} canAttach={canAttach && !pending} voice={voice} autoFocus={!initialSessionId && onScreen} />
                            </Animated.View>
                        )}
                    </LayoutAnimationConfig>
                </View>
            </View>
        </Animated.View>
    )
}
