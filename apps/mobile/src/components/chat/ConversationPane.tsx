import { FORMER_MEMBER, QUOTE_FROM_USER, RERUN_CONNECTION_ID, appendAttachmentsRef, authorShortName, prependQuote, threadsByMessage, authorIdOf, queuedPreview, runUsesScreen, scrollCueOf, screenSite, shouldFlush, shouldKeepQueued, buildAttachmentsRef, findPendingAlert, findPendingHitl, findUnknownPendingCall, needsHuman, paidDataSourcesByTurn, pendingTakeover, quickRepliesOf, quickReplyDraft, type AgentModels, type AgentView, type SessionStatus } from '@rerun/contracts'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native'
import Animated, { FadeInDown, FadeOutDown, LayoutAnimationConfig, SlideOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { acknowledgeAlert, cancelSubRun } from '@/api/chat'
import { runningModel } from '@/api/models'
import { transcribeRecording, uploadChatFile, uploadVoiceRecording } from '@/api/uploads'
import { useAuth } from '@/auth/AuthProvider'
import { setPendingDesktopOpen } from '@/desktop/pending-open'
import { track } from '@/lib/analytics'
import * as Haptics from '@/lib/haptics'
import { LIFTS_BY_SLIDING, useKeyboardHeight, useKeyboardLift, useRaiseAtRest } from '@/lib/keyboard-height'
import { useStableCallback } from '@/lib/use-stable-callback'
import { askForPushOnce, setConversationOnScreen } from '@/notifications/push'
import { noteRender } from '@/perf/renders'
import { endTiming } from '@/perf/timing'
import type { ChatEndpoints } from '@/chat/endpoints'
import type { FileOwner } from '@/api/files'
import { placeOf, rememberPlace } from '@/chat/reading-place'
import { useCoworkerChat } from '@/chat/useCoworkerChat'
import { useMessageActions } from '@/chat/useMessageActions'
import { useMessageTimes } from '@/chat/useMessageTimes'
import { useMessageFeedback } from '@/chat/useMessageFeedback'
import { useQueuedMessage } from '@/chat/useQueuedMessage'
import { useSkillProposals } from '@/chat/useSkillProposals'
import { cachedBoard } from '@/data/local-cache'
import { useMentionComputers } from '@/data/useMentionComputers'
import { useCoworkerSkills } from '@/data/useCoworkerSkills'
import { foremanLabel, useForemanName } from '@/data/useForemanName'
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
import { EditingBanner } from './EditingBanner'
import { ErrorCard, type ErrorCardActions } from './ErrorCard'
import { ConversationSkeleton } from './ConversationSkeleton'
import { CoworkerEmptyState, ForemanEmptyState } from './EmptyStates'
import type { StartedBy } from './origins/StartedByBanner'
import type { VoiceSender } from './useVoiceMessage'
import { AlertWidget } from './hitl/AlertWidget'
import { HitlBlock, UnknownCallBlock } from './hitl/HitlBlock'
import { LinkAuthorScope } from './link-origin'
import { PendingHitlPill } from './hitl/PendingHitlPill'
import { QueuedMessagePill } from './QueuedMessagePill'
import { RISE_IN, ScrollToEndButton, SINK_OUT } from './ScrollToEndButton'
import { replacesComposer } from './hitl/registry'
import { HITL_WIDGETS } from './hitl/widgets'
import { foremanMention, mentionAgentsOf, type MentionTrigger } from './mentions'
import { runPhase, stepGroupShowsActivity } from './run-phase'
import { RunStatus } from './RunStatus'
import { ChatScreen } from './screen/ChatScreen'
import { seenInThread } from './screen/seen-in-thread'
import { FloatingScreen, ScreenMirror } from './screen/FloatingScreen'
import { useAgentScreen } from './screen/useAgentScreen'
import { useTakeoverRequest } from './screen/useTakeoverRequest'
import { Suggestions } from './Suggestions'
import type { ThreadItem } from './threads/general-threads'
import { Transcript } from './Transcript'
import { QuoteBanner, QuoteReplyContext, useQuoteReply, type QuoteSide } from './QuoteReply'
import { useTranscriptWindow } from './transcript-window'
import { useKeyboardShown } from './useKeyboardShown'

// The transcript scrolls under the suggestions and the composer, going out of focus this far above
// them; scrolled to the end, the last message rests just above that band, sharp.
export const BLUR_ABOVE_FOOTER = 32
// The Chief of Staff has no skill of its own: `/` is not one of its symbols.
const FOREMAN_MENTION_TRIGGERS: readonly MentionTrigger[] = ['@', '#']
// How far above the end the thread still counts as at the bottom, and keeps following what comes.
const AT_BOTTOM = 24
// Under the fade at the top of the thread a block is not really seen, even when it is on screen.
const SEEN_BAND = 24
// A stretch of earlier messages drawn above the one on screen leaves it where it was.
const KEEP_PLACE_ABOVE = { minIndexForVisible: 0 }

export type ChatCoworker = { id: string; kind: 'coworker' | 'foreman'; name: string; role: string; status: AgentView['agent']['status'] }

type ConversationPaneProps = {
    coworker: ChatCoworker
    // Called once per page: a new conversation is named by its first send.
    makeEndpoints: () => ChatEndpoints
    initialSessionId: string | null
    onSessionCreated: (sessionId: string) => void
    models: AgentModels | null
    // What the hub says the conversation waits on. A call the app cannot name is one to answer only
    // when the session waits on a human; a notification is pinned until read.
    status: SessionStatus | null
    // The version of the conversation in a list the hub just sent: a transcript kept at it is current.
    updatedAt?: string | null
    onStatusChange: () => void
    // Where the conversation opens on the web, which draws every block.
    webUrl: string
    // False on the pager's neighbouring pages, mounted but off screen.
    onScreen?: boolean
    // The coworker that opened this conversation on this one, when it was not a person.
    startedBy?: StartedBy | null
    // Sent once the conversation's history is in, the text someone asked from the search.
    initialMessage?: string
    // False where the machine would refuse the upload: the Foreman of a box that predates its files.
    canAttach?: boolean
    // General only: the coworker's threads, each hung under the message it was opened after.
    threads?: ThreadItem[]
    onOpenThread?: (sessionId: string) => void
    // Floats over the composer.
    aboveComposer?: ReactNode
}

// One conversation on screen: the transcript, what waits on an answer, and the composer.
// The links of every message here open with the coworker who wrote them under the page.
export function ConversationPane(props: ConversationPaneProps) {
    return (
        <LinkAuthorScope author={props.coworker}>
            <ConversationPaneBody {...props} />
        </LinkAuthorScope>
    )
}

function ConversationPaneBody({ coworker, makeEndpoints, initialSessionId, onSessionCreated, models, status, updatedAt = null, onStatusChange, webUrl, onScreen = true, startedBy = null, initialMessage, canAttach = true, threads, onOpenThread, aboveComposer }: ConversationPaneProps) {
    noteRender('ConversationPane')
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const insets = useSafeAreaInsets()
    const t = useTranslations('mobileChat.pane')
    const tc = useTranslations('mobileCommon.errors')
    const tComposer = useTranslations('mobileChat.composer')
    const tQuote = useTranslations('mobileChat.quote')
    const scroll = useRef<ScrollViewInstance>(null)
    // The transcript a conversation opens on is shown already at its end; only what comes after scrolls.
    const shownTranscript = useRef(false)
    const [endpoints] = useState(makeEndpoints)
    // A message the engine refused while a run held the conversation waits behind it, as on the web.
    const enqueueRef = useRef<(text: string, behindRunId: string | null) => void>(() => {})
    const chat = useCoworkerChat({ endpoints, initialSessionId, knownUpdatedAt: updatedAt, onScreen, onSessionCreated, onRefused: (text, behindRunId) => enqueueRef.current(text, behindRunId) })
    const queue = useQueuedMessage(`${coworker.id}-${chat.sessionId ?? 'new'}`)
    const proposals = useSkillProposals(coworker.kind === 'coworker' ? chat.sessionId : null, chat.busy)
    // A decision lifts the wait the proposal raised on the session, as on the web.
    const statusChanged = useStableCallback(onStatusChange)
    const { proposals: proposalsById, pinned: pinnedProposals, pinnedIds, pendingId: pendingProposalId, decide: decideProposal } = proposals
    const skillProposals = useMemo(() => ({ proposals: proposalsById, pinned: pinnedProposals, pinnedIds, pendingId: pendingProposalId, decide: (proposalId: string, decision: 'accept' | 'dismiss') => decideProposal(proposalId, decision).then(statusChanged) }), [proposalsById, pinnedProposals, pinnedIds, pendingProposalId, decideProposal, statusChanged])
    const feedback = useMessageFeedback(chat.sessionId, coworker.kind === 'foreman' ? 'foreman' : 'agent')
    enqueueRef.current = queue.enqueue
    const [stopping, setStopping] = useState(false)
    const [draft, setDraft] = useState('')
    const composer = useRef<ComposerHandle>(null)
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
    const [uploading, setUploading] = useState(false)
    // Where the end of the thread stands below the screen, kept as the two answers the cue reads: every
    // scroll event would otherwise draw the pane again.
    const belowFold = useRef(0)
    const [fold, setFold] = useState({ nearEnd: true, pastBlock: false })
    // The web's stick-to-bottom: the thread follows what arrives only while the person sits at its
    // end. Scrolling up lets go; scrolling back down, sending or the arrow takes it again. Only the
    // person's own scrolling decides, never the scrolls the pane makes itself.
    // A conversation left above its end earlier in this launch opens where it was left.
    const [returningTo] = useState(() => (initialSessionId ? placeOf(initialSessionId) : null))
    const restoring = useRef(returningTo)
    const stuck = useRef(returningTo === null)
    const [following, setFollowing] = useState(returningTo === null)
    const stick = (value: boolean) => {
        if (stuck.current === value) return
        stuck.current = value
        setFollowing(value)
    }
    const touching = useRef(false)
    const metrics = useRef({ content: 0, viewport: 0 })
    const [blockHeight, setBlockHeight] = useState(0)
    const placeFold = (below: number, block: number) => {
        belowFold.current = below
        const nearEnd = below <= AT_BOTTOM
        const pastBlock = block > 0 && below > block
        if (nearEnd !== fold.nearEnd || pastBlock !== fold.pastBlock) setFold({ nearEnd, pastBlock })
    }
    const measureBlock = (height: number) => {
        setBlockHeight(height)
        placeFold(belowFold.current, height)
    }
    const [scrollTop, setScrollTop] = useState(0)
    const scrollOffset = useRef(0)
    const [viewport, setViewport] = useState(0)
    const [threadTop, setThreadTop] = useState(0)
    const [screenBox, setScreenBox] = useState<{ y: number; height: number } | null>(null)
    // The full screen opened over the conversation drives the coworker's screen: the thread lets go
    // of its own connection meanwhile, as the web hides its thumbnail.
    const [focused, setFocused] = useState(true)
    useFocusEffect(
        useCallback(() => {
            setFocused(true)
            return () => setFocused(false)
        }, [])
    )
    const [footerHeight, setFooterHeight] = useState(0)

    const keyboard = useKeyboardHeight()
    const keyboardRaise = useRaiseAtRest(insets.bottom)

    const lastAssistant = chat.messages.findLastIndex(message => message.role === 'assistant')
    const messageTimes = useMessageTimes(chat.messages)
    const threadRows = useMemo(() => threadsByMessage(messageTimes, threads ?? []), [messageTimes, threads])
    const openThread = useStableCallback((sessionId: string) => onOpenThread?.(sessionId))
    const isForeman = coworker.kind === 'foreman'
    // The Foreman is the person's own assistant: nobody else writes there, so nothing is signed.
    const authorIds = isForeman ? [] : [...new Set(chat.messages.flatMap(message => authorIdOf(message) ?? []))]
    const profileOf = useMemberProfiles(authorIds)
    const authorOf = useCallback((authorId: string) => (isForeman ? undefined : profileOf(authorId)), [isForeman, profileOf])
    const startedByName = startedBy?.name
    const startedByAgentId = startedBy?.agentId ?? null
    const banner = useMemo(() => (startedByName ? { agentId: startedByAgentId, name: startedByName } : null), [startedByAgentId, startedByName])
    const ownerKey = JSON.stringify(endpoints.fileOwner(chat.sessionId))
    const fileOwner = useMemo(() => JSON.parse(ownerKey) as FileOwner, [ownerKey])
    const transcriptWindow = useTranscriptWindow(chat.messages)
    const [dismissedCallId, setDismissedCallId] = useState<string | null>(null)
    // A live call never reads `idle` (it goes `working`, then `awaiting_*`): an idle session is one whose
    // block was closed, and it stays closed across a reload, as on the web.
    // A transcript kept from the last visit may hold a question answered since, on the web or by a
    // teammate: what acts on the run waits for the hub's own copy.
    const settled = chat.fresh && !chat.busy && !chat.error
    const pending = !settled || status === 'idle' ? null : findPendingHitl(chat.messages, dismissedCallId)
    const composerReplaced = replacesComposer(pending, HITL_WIDGETS)
    // Scrolled up past the whole block: the cue says what waits down the thread, as on the web.
    const blockOutOfSight = pending !== null && blockHeight > 0 && fold.pastBlock
    const [acknowledged, setAcknowledged] = useState<string | null>(null)
    const waitingOnHuman = status !== null && status !== 'error' && needsHuman(status)
    const pendingAlert = status === 'awaiting_ack' && settled ? findPendingAlert(chat.messages) : null
    const alert = pendingAlert && (pendingAlert.toolCallId ?? pendingAlert.message) !== acknowledged ? pendingAlert : null
    const unknownCall = pending || alert || !settled || !waitingOnHuman ? null : findUnknownPendingCall(chat.messages)
    const replies = !settled || pending || unknownCall || lastAssistant < 0 || lastAssistant !== chat.messages.length - 1 ? [] : quickRepliesOf(chat.messages[lastAssistant])
    // A General with no message yet but threads already opened shows them, not the empty state, as on the web.
    const empty = chat.history === 'ready' && chat.messages.length === 0 && !chat.busy && threadRows.leading.length === 0
    // The empty state is centered in the room the keyboard leaves: it is not slid under the header.
    const lift = useKeyboardLift(keyboard.height, insets.bottom, !empty)
    const raisedAtRest = empty ? 0 : keyboardRaise
    // A takeover the app can draw is asked on the screen it is about, not in a block of its own.
    const takeoverPending = pending?.kind === 'takeover' && composerReplaced ? pending : null
    const runOnScreen = useMemo(() => runUsesScreen(chat.messages), [chat.messages])
    const paidSourcesByTurn = useMemo(() => paidDataSourcesByTurn(chat.messages), [chat.messages])
    // The live screen stands in for the run's status while the run works on it.
    const screenShown = chat.history === 'ready' && ((chat.busy && runOnScreen) || !!takeoverPending)
    const screen = useAgentScreen(coworker.id, screenShown && onScreen && focused)
    const screenUnavailable = screen.status === 'error' || screen.status === 'disconnected'
    const screenInThread = screenShown && (!screenUnavailable || !!takeoverPending)
    const visibleTop = scrollTop + raisedAtRest + insets.top + CHAT_HEADER_HEIGHT + SEEN_BAND
    const visibleBottom = scrollTop + viewport - footerHeight
    const screenSeen = !screenBox || seenInThread({ top: threadTop + screenBox.y, bottom: threadTop + screenBox.y + screenBox.height }, { top: visibleTop, bottom: visibleBottom })
    const floatingShown = screenInThread && screen.status === 'live' && !screenSeen && focused
    const { mirror } = screen
    useEffect(() => mirror(floatingShown), [mirror, floatingShown])
    const phase = runPhase(chat.status, chat.messages.at(-1))

    // Photos go to the coworker's folder first; the message then names their paths, as on the web, and
    // shows them from the phone until the transcript comes back.
    const sessionId = chat.sessionId
    useEffect(() => {
        if (onScreen && chat.fresh) endTiming('chat fresh', `${chat.messages.length} messages`)
    }, [onScreen, chat.fresh, chat.messages.length])
    useEffect(() => {
        if (!onScreen) return
        setConversationOnScreen(sessionId)
        return () => setConversationOnScreen(null)
    }, [sessionId, onScreen])

    // A field in a waiting block sits above the composer: once the keyboard is up, the block's own
    // buttons are scrolled back into view.
    useKeyboardShown(() => stuck.current && scroll.current?.scrollToEnd({ animated: true }))

    const followEnd = () => {
        stick(true)
        scroll.current?.scrollToEnd({ animated: true })
    }
    // While a run holds the conversation, what the person sends waits behind it and leaves on its
    // own once the run ends, the web's queue.
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

    // A message found waiting when the conversation opened only keeps waiting while a run still
    // holds it; otherwise it goes back to the composer rather than leaving days later on its own.
    const restored = queue.queued && queue.queued.id === queue.restoredId ? queue.queued : null
    useEffect(() => {
        if (!restored || !chat.fresh || chat.busy || status === 'working') return
        if (shouldKeepQueued(restored, chat.activeRunId())) return
        setDraft(current => current || queuedPreview(restored.text).text)
        queue.clear()
    }, [restored, chat, status, queue])

    const askedRef = useRef(false)
    useEffect(() => {
        if (!initialMessage || askedRef.current || chat.history !== 'ready') return
        askedRef.current = true
        send(initialMessage)
    })

    const sendQueuedNow = async () => {
        setStopping(true)
        await chat.stop()
        setStopping(false)
    }

    // The web's `bringBlockIn`: a block taller than the room left between the header and the footer
    // comes in by its top, so its first line is read before its buttons.
    const jumpToPending = () => {
        const top = insets.top + CHAT_HEADER_HEIGHT + spacing.sm
        const room = metrics.current.viewport - top - footerHeight
        if (blockHeight <= room) return followEnd()
        stick(false)
        const blockBottom = metrics.current.content - footerHeight - BLUR_ABOVE_FOOTER
        scroll.current?.scrollTo({ y: Math.max(0, blockBottom - blockHeight - top), animated: true })
    }
    // Following the end counts as being there, as on the web: the stream outruns the scroll for a
    // moment on every chunk, and the arrow must not blink through it.
    const cue = scrollCueOf({ pending: pending !== null, pendingInView: !blockOutOfSight, atBottom: following || fold.nearEnd })

    // A reply that announces a value the user still has to type is finished in the composer, as on the web.
    const pickReply = (reply: string) => {
        const draftReply = quickReplyDraft(reply)
        if (!draftReply) return void submit(reply)
        setDraft(draftReply)
        composer.current?.focus()
    }

    const submit = async (text: string) => {
        const message = text.trim()
        if (messageActions.editingId) {
            if (message && (await messageActions.sendEdit(message))) setDraft('')
            return
        }
        if (!message && attachments.length === 0 && !quote) return
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        if (caller) askForPushOnce(caller).catch(() => {})
        if (attachments.length === 0 || !caller) {
            setDraft('')
            setQuote(null)
            send(prependQuote(message, quote))
            return
        }
        setUploading(true)
        try {
            const { paths, files } = await uploadAttachments(caller, coworker.id, attachments)
            setDraft('')
            setAttachments([])
            setQuote(null)
            send(prependQuote(appendAttachmentsRef(message, buildAttachmentsRef(paths)), quote), files)
        } catch {
            Alert.alert(t('attachFailed'), tc('tryAgainShortly'))
        } finally {
            setUploading(false)
        }
    }

    // A voice message carries the attachments picked before it, their marker after its own, as on the web.
    // A throw keeps the recording for a retry.
    const voice: VoiceSender | undefined = caller
        ? {
              upload: uri => uploadVoiceRecording(caller, endpoints.fileOwner(chat.sessionId), uri),
              transcribe: uri => transcribeRecording(caller, uri),
              send: async text => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  askForPushOnce(caller).catch(() => {})
                  if (attachments.length === 0) {
                      setQuote(null)
                      send(prependQuote(text, quote))
                      return
                  }
                  const { paths, files } = await uploadAttachments(caller, coworker.id, attachments)
                  setAttachments([])
                  setQuote(null)
                  send(prependQuote(appendAttachmentsRef(text, buildAttachmentsRef(paths)), quote), files)
              },
          }
        : undefined

    const chip = runningModel(models)
    const model = chip && !models?.pinned ? { ...chip, label: t('defaultModel', { model: chip.label }) } : chip

    const skills = useCoworkerSkills(isForeman ? null : coworker.id)
    const mentionComputers = useMentionComputers()
    const workspaceAgents = useWorkspaceAgents()
    const boxes = me ? (cachedBoard(me.workspace.id).read()?.boxes ?? []) : []
    const foremanName = useForemanName()
    const coworkerMentions = workspaceAgents ? mentionAgentsOf(workspaceAgents, boxes, isForeman ? null : coworker.id) : null
    const mentionAgents = coworkerMentions && !isForeman ? [foremanMention(foremanLabel(foremanName)), ...coworkerMentions] : coworkerMentions
    // The web's chat notices: a dead sign-in opens the connection the coworker runs on, used-up
    // credits open the two plans. Rerun itself has no sign-in, so it opens the list.
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
    const stopTask = useStableCallback((taskId: string) => {
        const runId = chat.activeRunId()
        if (caller && runId) cancelSubRun(caller, coworker.id, runId, taskId).catch(() => Alert.alert(t('stopTaskFailed'), tc('tryAgainShortly')))
    })
    const messageActions = useMessageActions({
        chat,
        caller,
        endpoints,
        agentId: coworker.id,
        coworkerName: coworker.name,
        onEdit: text => {
            setDraft(text)
            composer.current?.focus()
        },
    })
    const cancelEdit = () => {
        messageActions.cancelEdit()
        setDraft('')
    }
    // A coworker's reply asked again replaces it in the engine; the Chief of Staff's route only appends.
    const regenerate = useStableCallback(() => {
        const lastReply = chat.messages.findLast(message => message.role === 'assistant')
        if (isForeman || !lastReply) return void chat.regenerate()
        void messageActions.regenerateReply(lastReply.id)
    })
    // A passage of the person is theirs; one of another member of a shared conversation is named.
    const quotedAuthorOf = (side: QuoteSide, messageId: string) => {
        if (side === 'assistant') return coworker.name
        const message = chat.messages.find(item => item.id === messageId)
        const authorId = message ? authorIdOf(message) : undefined
        if (!authorId || authorId === me?.user.id) return QUOTE_FROM_USER
        return authorShortName(authorOf(authorId) ?? FORMER_MEMBER)
    }
    const { quote, setQuote, showSource: showQuoteSource, context: quoteReply } = useQuoteReply({ enabled: !isForeman, authorOf: quotedAuthorOf, scroll, scrollOffset, onLeaveEnd: () => stick(false), focusComposer: () => composer.current?.focus() })
    // A quote belongs to the conversation it was taken in.
    const [quoteSession, setQuoteSession] = useState(chat.sessionId)
    if (quoteSession !== chat.sessionId) {
        setQuoteSession(chat.sessionId)
        setQuote(null)
    }
    const transcript = { messages: chat.messages, busy: chat.busy, agentId: isForeman ? null : coworker.id, coworkerName: coworker.name, fileOwner, hiddenCallId: alert?.toolCallId ?? null, skillProposals, onStopTask: stopTask, onRegenerate: pending ? undefined : regenerate, ratingOf: feedback.ratingOf, onRate: feedback.rate, paidSourcesByTurn, authorOf, startedBy: banner, threadRows, onOpenThread: openThread, onMessageActions: isForeman ? undefined : messageActions.open }
    const placeholder = pending || unknownCall ? t('answerPlaceholder', { name: coworker.name }) : quote ? tQuote('placeholder') : tComposer(isForeman ? 'placeholderNoSkill' : 'placeholder')

    return (
        <QuoteReplyContext value={quoteReply}>
            <Animated.View style={[{ flex: 1, paddingBottom: LIFTS_BY_SLIDING ? insets.bottom : 0 }, lift]}>
                <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                    <ScrollView
                        ref={scroll}
                        testID="conversation-thread"
                        style={StyleSheet.absoluteFill}
                        contentInset={{ top: raisedAtRest }}
                        scrollIndicatorInsets={{ top: raisedAtRest, bottom: footerHeight }}
                        keyboardDismissMode="interactive"
                        keyboardShouldPersistTaps="handled"
                        scrollEventThrottle={64}
                        maintainVisibleContentPosition={KEEP_PLACE_ABOVE}
                        onScroll={({ nativeEvent: { contentSize, contentOffset, layoutMeasurement } }) => {
                            scrollOffset.current = contentOffset.y
                            const below = Math.max(0, contentSize.height - contentOffset.y - layoutMeasurement.height - BLUR_ABOVE_FOOTER)
                            metrics.current = { content: contentSize.height, viewport: layoutMeasurement.height }
                            placeFold(below, blockHeight)
                            // A screen from the top of what is drawn, the stretch before it comes in above.
                            if (transcriptWindow.hasEarlier && contentOffset.y < layoutMeasurement.height) transcriptWindow.showEarlier()
                            if (screenInThread) {
                                setScrollTop(contentOffset.y)
                                setViewport(layoutMeasurement.height)
                            }
                            if (touching.current) stick(below <= AT_BOTTOM)
                            if (chat.sessionId) rememberPlace(chat.sessionId, stuck.current ? null : below)
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
                            if (onScreen && chat.history === 'ready') endTiming('chat open', `${chat.messages.length} messages, ${chat.fresh ? 'from the hub' : 'kept on the phone'}`)
                            metrics.current = { ...metrics.current, content: height }
                            if (stuck.current) scroll.current?.scrollToEnd({ animated: shownTranscript.current })
                            else if (restoring.current !== null && chat.history === 'ready' && metrics.current.viewport > 0) {
                                scroll.current?.scrollTo({ y: Math.max(0, height - metrics.current.viewport - BLUR_ABOVE_FOOTER - restoring.current), animated: false })
                                restoring.current = null
                            }
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
                        {empty && (isForeman ? <ForemanEmptyState onSend={submit} onPrefill={setDraft} /> : <CoworkerEmptyState agentId={coworker.id} mood={moodOf(coworker.status)} asleep={coworker.status === 'offline'} onSend={submit} />)}
                        {chat.history === 'ready' && !empty && (
                            // The transcript a conversation opens on is already there; the first bubble of a
                            // new conversation, sent as the list appears, still rises.
                            <LayoutAnimationConfig skipEntering={!chat.busy}>
                                {transcriptWindow.earlier.map(range => (
                                    <View key={range.key} style={{ gap: spacing.xl, marginBottom: spacing.xl }}>
                                        <Transcript {...transcript} from={range.from} to={range.to} />
                                    </View>
                                ))}
                                <View key="recent" style={{ gap: spacing.xl }} onLayout={event => setThreadTop(event.nativeEvent.layout.y)}>
                                    {transcriptWindow.recent && <Transcript {...transcript} from={transcriptWindow.recent.from} to={transcriptWindow.recent.to} />}
                                    {pending && !takeoverPending && (
                                        <Animated.View key={pending.toolCallId} entering={FadeInDown.duration(280)} onLayout={event => measureBlock(event.nativeEvent.layout.height)}>
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
                                                if (takeoverPending) measureBlock(height)
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

                    <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ gap: spacing.md, width: '100%', maxWidth: CHAT_COLUMN_MAX_WIDTH, alignSelf: 'center', paddingTop: composerReplaced && !alert ? 0 : spacing.sm }}>
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
                        {aboveComposer}
                        {replies.length > 0 && !draft && !queue.queued && <Suggestions items={replies} onPick={pickReply} />}
                        {queue.queued && (
                            <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(200)} style={{ paddingHorizontal: spacing.md }}>
                                <QueuedMessagePill text={queue.queued.text} busy={chat.busy} pending={stopping} onSendNow={sendQueuedNow} onDiscard={queue.clear} />
                            </Animated.View>
                        )}
                        {/* The composer's glass goes blank under a parent below full opacity, and when it is laid while
                            moving: it comes back in place once a block is answered, and only leaves with a slide. */}
                        {messageActions.editingId && <EditingBanner onCancel={cancelEdit} />}
                        {quote && !messageActions.editingId && !composerReplaced && <QuoteBanner quote={quote} onShowSource={() => showQuoteSource(quote)} onRemove={() => setQuote(null)} />}
                        {!composerReplaced && (
                            <Animated.View exiting={SlideOutDown.duration(280)} style={{ paddingHorizontal: spacing.md }}>
                                <Composer ref={composer} value={draft} onChangeText={setDraft} attachments={attachments} onAttachmentsChange={setAttachments} skills={skills} mentionAgents={mentionAgents} mentionComputers={mentionComputers} triggers={isForeman ? FOREMAN_MENTION_TRIGGERS : undefined} onSend={() => submit(draft)} onStop={chat.stop} running={chat.busy || uploading} placeholder={placeholder} model={model} onOpenModel={openModel} canAttach={canAttach && !pending} voice={voice} autoFocus={!initialSessionId && onScreen} onScreen={onScreen} />
                            </Animated.View>
                        )}
                    </View>
                </View>
            </Animated.View>
        </QuoteReplyContext>
    )
}
