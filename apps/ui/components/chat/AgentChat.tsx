'use client'

import { ModelSelector } from '@/components/agent/ModelSelector'
import { ThreadBranch } from '@/components/agent/sheet/ThreadBranch'
import { Context } from '@/components/ai-elements/context'
import { Conversation, ConversationContent, ConversationEmptyState, type ConversationHandle, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { ActionApprovalBlock } from '@/components/chat/ActionApprovalBlock'
import { AlertBlock } from '@/components/chat/AlertBlock'
import { McpSignInBlock } from '@/components/chat/McpSignInBlock'
import { SecretRequestBlock } from '@/components/chat/SecretRequestBlock'
import { ChatScreen } from '@/components/chat/ChatScreen'
import { BudgetExhaustedNotice, usePriceArm } from '@rerun/cloud/billing.client'
import { ProviderErrorNotice } from '@/components/chat/ProviderErrorNotice'
import { ComposerSubscriptionCta } from '@/components/chat/ComposerSubscriptionCta'
import { InstallGate } from '@/components/chat/InstallGate'
import { QuestionForm } from '@/components/chat/QuestionForm'
import type { QuestionFormHandle } from '@rerun/ui/chat'
import { SkillProposalDock } from '@/components/chat/SkillProposalDock'
import { ChatActivityLoader } from '@/components/chat/ChatActivityLoader'
import { useAgentBuddyMood } from '@/hooks/useAgentBuddyMood'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import type { CatalogEntry } from '@rerun/ui/new-agent'
import { ChatComposer, type ChatComposerHandle } from '@/components/chat/ChatComposer'
import { useMentionAutocomplete } from '@/components/chat/MentionAutocomplete'
import { MessageFeedbackDialog } from '@/components/chat/MessageFeedbackDialog'
import { AuthoredGroup } from '@/components/chat/AuthoredGroup'
import { ChatTimeSeparator } from '@/components/chat/ChatTimeSeparator'
import { MessageView } from '@/components/chat/MessageView'
import { ServiceSuggestionBlock } from '@/components/services/ServiceSuggestionBlock'
import { SpendRequestBlock } from '@/components/chat/spend/SpendRequestBlock'
import { SkeletonChat } from '@/components/ui/skeleton'

import { cancelRunAction, getRunAction, updateAgentConfigAction } from '@/app/api/_actions/agent.actions'
import { acknowledgeSessionAlertAction, cancelSessionRunsAction, fetchSessionActiveRun, fetchSessionMessages, finalizeSessionAction, openSessionAction } from '@/app/api/_actions/session.actions'
import type { SessionUsageSeed } from '@/app/api/_services/chat.service'
import type { ThreadRow } from '@/app/api/_services/conversation.service'
import { useAgentModel } from '@/hooks/useAgentModel'
import { refreshWorkspaceConnections, useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import { useArriveByTop } from '@/hooks/useArriveByTop'
import { useMemberProfiles } from '@/hooks/useMemberProfiles'
import { useMessageFeedback } from '@/hooks/useMessageFeedback'
import { useMessageTimes } from '@/hooks/useMessageTimes'
import { useQueuedMessage } from '@/hooks/useQueuedMessage'
import { useRunReconnect } from '@/hooks/useRunReconnect'
import { invalidateAgentSkillSummaries } from '@/hooks/useAgentSkillSummaries'
import { useSkillProposals } from '@/hooks/useSkillProposals'
import { useModelPickerStore } from '@/stores/model-picker.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { stepGroupShowsActivity } from '@/lib/agent-chat-loader'
import { buildInstallMessage } from '@/lib/chat/install-marker'
import { contextStatsOf } from '@/lib/chat/context-stats'
import { summarizePendingHitl } from '@/lib/chat/hitl-cue'
import { hitlCallBefore, hitlCallKind, isLatestUserMessage, spentAfter } from '@/lib/chat/hitl-receipts'
import { turnRanOutOfPaidCredit } from '@/lib/chat/paid-data-credit'
import { authorTurnsOf } from '@/lib/chat/message-author'
import { splitTurnsAtBreaks, timeBreaksOf } from '@/lib/chat/message-times'
import { threadsByMessage } from '@/lib/chat/thread-rows'
import { shouldFlush, shouldKeepQueued } from '@/lib/chat/queued-message'
import { classifyChatError, installInFlightOf, teammateRunOf, unwrapChatError } from '@/lib/chat-error'
import { findPendingAlert, findPendingHitl, HITL_CANCELLED, pendingApprovals, pendingMcpSignIn, pendingQuestions, pendingSecrets, pendingTakeover, serializeApprovalDecisions, serializeSpendDecision, type SpendDecision } from '@/lib/chat-hitl'
import { lastUserText } from '@/lib/chat-payload'
import { historyCovers, needsReconcile } from '@/lib/chat/transcript-reconcile'
import { browserPermission } from '@/lib/notifications/browser'
import { modelContextWindow } from '@/lib/engine/models'
import { rerunCreditOf } from '@/lib/engine/ai-sources'
import { toGroup } from '@/lib/engine/model-groups'
import { isLifetimePlan, isPremiumModelEntitled } from '@rerun/cloud/billing'
import { createClient } from '@/supabase/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { useChat } from '@ai-sdk/react'
import { COWORKER_STARTER_SUGGESTIONS, paidDataSourcesByTurn, RERUN_CONNECTION_ID, runUsesScreen, screenSite } from '@rerun/contracts'
import { track } from '@rerun/analytics/client'
import { AnimatePresence, motion } from 'motion/react'
import { DefaultChatTransport } from 'ai'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { scrollFadeMask, useScrollEdges } from '@rerun/ui/primitives'
import { toast } from 'sonner'

const SCROLL_FADE = 32
const RESUME_STALL_MS = 30_000

export type AgentChatSessionInsert = {
    id: string
    agentId: string
    originAgentId: string | null
    status: 'working' | 'idle' | 'error'
}

type AgentChatProps = {
    uid: string
    active: boolean
    agentId: string
    agentName: string
    sessionId: string | null
    onSessionCreated: (id: string) => void
    initialRunId?: string | null
    arrival?: number
    mentionAgents?: { id: string; name: string; handle: string | null }[]
    mentionSkills?: { slug: string; name: string; description?: string }[]
    sessionWorking?: boolean
    sessionIdle?: boolean
    alertPending?: boolean
    body?: Record<string, unknown>
    header?: ReactNode
    suppressEmptyState?: boolean
    setup?: { pending: boolean; prompt: string; skipped: boolean; sessionId: string | null }
    onSetupSkipped?: () => void
    onOpenInstall?: (sessionId: string) => void
    onRunFinished?: () => void
    onSessionInserted?: (session: AgentChatSessionInsert) => void
    onSessionStatusChange?: (sessionId: string, status: 'working' | 'idle' | 'error') => void
    onMessageSent?: () => void
    onNewConversation?: () => void
    threads?: ThreadRow[]
    onOpenThread?: (sessionId: string, title: string) => void
    composerPlaceholder?: string
}

export function AgentChat({ uid, active, agentId, agentName, sessionId, onSessionCreated, initialRunId, arrival = 0, mentionAgents = [], mentionSkills = [], sessionWorking = false, sessionIdle = false, alertPending = false, body, header, suppressEmptyState = false, setup, onSetupSkipped, onOpenInstall, onRunFinished, onSessionInserted, onSessionStatusChange, onMessageSent, onNewConversation, threads, onOpenThread, composerPlaceholder }: AgentChatProps) {
    const t = useTranslations('chat.agentChat')
    const tHitlCue = useTranslations('chat.hitlCue')
    const { workspace, user } = useSession()
    const userId = user?.id
    const onSessionCreatedRef = useRef(onSessionCreated)
    onSessionCreatedRef.current = onSessionCreated

    const sessionIdRef = useRef(sessionId)
    sessionIdRef.current = sessionId

    const onSessionInsertedRef = useRef(onSessionInserted)
    onSessionInsertedRef.current = onSessionInserted

    const onMessageSentRef = useRef(onMessageSent)
    onMessageSentRef.current = onMessageSent

    const onRunFinishedRef = useRef(onRunFinished)
    onRunFinishedRef.current = onRunFinished

    const { queued, restoredId: restoredQueuedId, enqueue: enqueueMessage, clear: clearQueued } = useQueuedMessage(uid)

    const composerRef = useRef<ChatComposerHandle | null>(null)

    const questionFormRef = useRef<QuestionFormHandle | null>(null)

    const syncMentionTarget = useCallback((text: string) => {
        composerRef.current?.sync(text)
        questionFormRef.current?.sync(text)
    }, [])
    const { inputRef, menu: mentionMenu, tokens: mentionTokens, textareaProps: mentionTextareaProps } = useMentionAutocomplete(mentionAgents, mentionSkills, syncMentionTarget)

    const chatRootRef = useRef<HTMLDivElement>(null)
    const [mentionMenuTop, setMentionMenuTop] = useState(0)
    const mentionMenuOpen = mentionMenu !== null
    useLayoutEffect(() => {
        const root = chatRootRef.current
        const input = inputRef.current
        if (!mentionMenuOpen || !root || !input) return
        setMentionMenuTop(input.getBoundingClientRect().top - root.getBoundingClientRect().top)
    }, [mentionMenuOpen, inputRef])

    const [uploading, setUploading] = useState(false)

    const buddyMood = useAgentBuddyMood(agentId)
    const uploadTarget = useMemo(() => ({ kind: 'agent', agentId }) as const, [agentId])

    const { selection: modelSelection, select: selectModel } = useAgentModel(agentId)
    const modelSelectionRef = useRef(modelSelection)
    modelSelectionRef.current = modelSelection

    const bodyRef = useRef(body)
    bodyRef.current = body

    const activeRunIdRef = useRef<string | null>(null)

    const interceptFetch = useCallback(
        async (url: string | URL | Request, init?: RequestInit) => {
            const res = await fetch(url, init)
            const newSessionId = res.headers.get('X-Session-Id')
            if (newSessionId && !sessionIdRef.current) {
                sessionIdRef.current = newSessionId
                onSessionCreatedRef.current(newSessionId)
                onSessionInsertedRef.current?.({ id: newSessionId, agentId, originAgentId: null, status: 'working' })
            }
            const runId = res.headers.get('X-Run-Id')
            if (runId) activeRunIdRef.current = runId
            return res
        },
        [agentId]
    )

    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: '/api/chat',
                body: () => ({ agentId, sessionId: sessionIdRef.current, connectionId: modelSelectionRef.current.connectionId, model: modelSelectionRef.current.model, ...bodyRef.current }),
                prepareSendMessagesRequest: ({ body, messages }) => ({ body: { ...body, text: lastUserText(messages) } }),
                fetch: interceptFetch as typeof globalThis.fetch,
                prepareReconnectToStreamRequest: () => ({
                    api: `/api/chat/resume?agentId=${encodeURIComponent(agentId)}&runId=${encodeURIComponent(activeRunIdRef.current ?? '')}`,
                }),
            }),
        [agentId, interceptFetch]
    )

    const chatId = `chat-${uid}`

    const completedRef = useRef(false)
    const mountedRef = useRef(true)

    const {
        messages,
        setMessages,
        sendMessage: sendChatMessage,
        regenerate,
        status,
        error,
        clearError,
        resumeStream,
        stop: stopStream,
    } = useChat({
        id: chatId,
        transport,
        experimental_throttle: 80,
        onFinish: ({ isAbort, isDisconnect, isError }) => {
            if (!isAbort && !isDisconnect && !isError) {
                completedRef.current = true
            }
            if (!isDisconnect && !isError) void refreshWorkspaceConnections()
            onRunFinishedRef.current?.()
        },
    })

    const askNotificationPermission = useNotificationsStore(state => state.askPermission)

    const sendingRef = useRef(false)
    useEffect(() => {
        if (status === 'ready' || status === 'error') sendingRef.current = false
    }, [status])

    const lastSentTextRef = useRef<string | null>(null)

    const lastSendQueuedRef = useRef(false)

    const conversationRef = useRef<ConversationHandle | null>(null)
    const [scroller, setScroller] = useState<HTMLElement | null>(null)
    const [chatRoot, setChatRoot] = useState<HTMLElement | null>(null)
    useEffect(() => {
        setScroller(conversationRef.current?.scrollRef.current ?? null)
        setChatRoot(chatRootRef.current)
    }, [])
    const scrollEdges = useScrollEdges(scroller, { fadeSize: SCROLL_FADE })
    const scrollMask = scrollFadeMask(scrollEdges)

    const sendMessage = useCallback(
        (opts: { text: string }, options?: { body?: Record<string, unknown> }): boolean => {
            if (sendingRef.current || status === 'submitted' || status === 'streaming') return false
            sendingRef.current = true
            lastSentTextRef.current = opts.text
            lastSendQueuedRef.current = options?.body?.queued === true
            if (browserPermission() === 'default') askNotificationPermission()
            sendChatMessage(userId ? { ...opts, metadata: { authorId: userId } } : opts, options)
            conversationRef.current?.scrollToBottom()
            return true
        },
        [sendChatMessage, status, askNotificationPermission, userId]
    )

    const draftReply = useCallback(
        (text: string) => {
            const el = inputRef.current
            if (!composerRef.current?.restore(text) && el && !el.value.startsWith(text)) {
                el.value = `${text}${el.value.trimStart()}`
                el.setSelectionRange(el.value.length, el.value.length)
                composerRef.current?.sync(el.value)
            }
            composerRef.current?.focus()
        },
        [inputRef]
    )

    const showInstallGate = !!setup?.pending && !setup.skipped && messages.length === 0
    const connectors = useConnectorServices(agentId)
    const installApps = useMemo(() => {
        const bySlug = new Map<string, CatalogEntry>()
        for (const service of connectors.map.values()) {
            if (!service.custom && !bySlug.has(service.slug)) bySlug.set(service.slug, { slug: service.slug, name: service.name, icon: service.icon, category: service.category })
        }
        return [...bySlug.values()]
    }, [connectors.map])

    const [dismissedHitlCallId, setDismissedHitlCallId] = useState<string | null>(null)

    const pendingHitl = useMemo(() => {
        if (status === 'streaming' || status === 'submitted') return null
        if (sessionIdle) return null
        return findPendingHitl(messages, dismissedHitlCallId)
    }, [messages, status, sessionIdle, dismissedHitlCallId])

    const arrivedRef = useRef(0)
    useEffect(() => {
        if (!active || arrival === arrivedRef.current) return
        arrivedRef.current = arrival
        conversationRef.current?.scrollToBottom('instant')
    }, [active, arrival])
    const pendingHitlRef = useArriveByTop(conversationRef, pendingHitl ? `${pendingHitl.toolCallId}:${arrival}` : null)
    const pendingCue = useMemo(() => (pendingHitl ? { key: pendingHitl.toolCallId, summary: summarizePendingHitl(pendingHitl.kind, pendingHitl.input, tHitlCue), blockRef: pendingHitlRef } : null), [pendingHitl, pendingHitlRef, tHitlCue])

    const pendingAlert = useMemo(() => (alertPending ? findPendingAlert(messages) : null), [alertPending, messages])
    const [acknowledging, setAcknowledging] = useState(false)

    const [alertAt, setAlertAt] = useState<{ sessionId: string; at: string | null } | null>(null)
    const pendingAlertToolCallId = pendingAlert?.toolCallId ?? null
    useEffect(() => {
        if (!alertPending || !sessionId) return
        let cancelled = false
        void selectMaybeSingle(createClient(), 'sessions', ['updated_at'] as const, { id: sessionId }).then(({ data }) => {
            if (!cancelled) setAlertAt({ sessionId, at: data?.updated_at ?? null })
        })
        return () => {
            cancelled = true
        }
    }, [alertPending, sessionId, pendingAlertToolCallId])

    const skillProposals = useSkillProposals(sessionId ?? null, status)

    const undecidedProposalIdsRef = useRef<ReadonlySet<string>>(new Set())
    useEffect(() => {
        const undecided = new Set<string>()
        let landed = false
        for (const proposal of skillProposals.proposals.values()) {
            if (proposal.status === 'proposed' || proposal.status === 'accepted') undecided.add(proposal.id)
            else if (proposal.status === 'applied' && undecidedProposalIdsRef.current.has(proposal.id)) landed = true
        }
        undecidedProposalIdsRef.current = undecided
        if (landed) invalidateAgentSkillSummaries(agentId)
    }, [skillProposals.proposals, agentId])

    const acknowledgeAlert = useCallback(async () => {
        if (!sessionId) return
        setAcknowledging(true)
        try {
            await acknowledgeSessionAlertAction(sessionId)
            onSessionStatusChange?.(sessionId, 'idle')
        } finally {
            setAcknowledging(false)
        }
    }, [sessionId, onSessionStatusChange])

    const [seededUsage, setSeededUsage] = useState<SessionUsageSeed | null>(null)

    const contextStats = useMemo(() => contextStatsOf(messages, seededUsage, modelSelection.model), [messages, modelSelection.model, seededUsage])

    const [runError, setRunError] = useState<string | null>(null)

    const rerunCredit = useMemo(() => rerunCreditOf(workspace), [workspace])
    const creditHasRoom = !rerunCredit.paused && rerunCredit.budgetMicros > rerunCredit.usedMicros
    const creditHasRoomRef = useRef(creditHasRoom)
    useEffect(() => {
        creditHasRoomRef.current = creditHasRoom
    }, [creditHasRoom])
    const replayedRunErrorRef = useRef<string | null>(null)
    const showReplayedRunError = useCallback((error: string) => {
        if (creditHasRoomRef.current && classifyChatError(unwrapChatError(error)) === 'budget') return
        replayedRunErrorRef.current = error
        setRunError(error)
    }, [])

    useEffect(() => {
        if (status !== 'submitted' && status !== 'streaming') return
        setRunError(null)
        replayedRunErrorRef.current = null
    }, [status])

    useEffect(() => {
        setRunError(null)
    }, [sessionId])

    const [historyLoading, setHistoryLoading] = useState(false)
    const historyLoadedRef = useRef<string | null>(null)
    const [snapshotPendingFor, setSnapshotPendingFor] = useState<string | null>(null)
    const sessionWorkingRef = useRef(sessionWorking)
    const seedProposalsRef = useRef(skillProposals.seed)
    const refreshProposalsRef = useRef(skillProposals.refresh)
    useEffect(() => {
        sessionWorkingRef.current = sessionWorking
        seedProposalsRef.current = skillProposals.seed
        refreshProposalsRef.current = skillProposals.refresh
    })
    const proposalsLoadedRef = useRef<string | null>(null)
    const [attachRunId, setAttachRunId] = useState<string | null>(initialRunId ?? null)
    const attachedRunRef = useRef<string | null>(null)

    useEffect(() => {
        setSeededUsage(null)
    }, [sessionId])

    useEffect(() => {
        if (!active || !sessionId) return
        return useUnseenRunsStore.getState().view(sessionId)
    }, [active, sessionId])

    useEffect(() => {
        if (!active || !sessionId || historyLoadedRef.current === sessionId || messages.length > 0) return
        if (initialRunId) return
        historyLoadedRef.current = sessionId
        setHistoryLoading(true)
        setSnapshotPendingFor(sessionId)
        openSessionAction(sessionId)
            .then(snapshot => {
                if (snapshot.messages.length > 0 && !attachedRunRef.current) {
                    setMessages(snapshot.messages as Parameters<typeof setMessages>[0])
                }
                if (snapshot.usage) setSeededUsage(snapshot.usage)
                seedProposalsRef.current(sessionId, snapshot.proposals)
                proposalsLoadedRef.current = sessionId
                if (sessionIdRef.current !== sessionId) return
                if (snapshot.lastError) showReplayedRunError(snapshot.lastError)
                if (snapshot.activeRunId && sessionWorkingRef.current && !activeRunIdRef.current) setAttachRunId(snapshot.activeRunId)
            })
            .catch(() => {})
            .finally(() => {
                setHistoryLoading(false)
                setSnapshotPendingFor(null)
            })
    }, [active, sessionId, messages.length, setMessages, initialRunId, showReplayedRunError])

    const reconnecting = useRunReconnect({
        error,
        completedRef,
        start: () => {
            const runId = activeRunIdRef.current
            const sid = sessionIdRef.current
            if (!runId || !sid) return null
            return {
                runId,
                getRun: () => getRunAction(agentId, runId),
                fetchMessages: () => fetchSessionMessages(sid),
                onSettled: async ({ errored, errorText }) => {
                    await finalizeSessionAction(sid, errored ? 'error' : 'idle', { onlyWhileWorking: true }).catch(() => {})
                    activeRunIdRef.current = null
                    if (errorText) setRunError(errorText)
                },
            }
        },
        resumeStream,
        setMessages: setMessages as (messages: never[]) => void,
        clearError,
    })

    const showLoader = status === 'submitted' || status === 'streaming' || sessionWorking || reconnecting

    const flushingRef = useRef<string | null>(null)
    useEffect(() => {
        if (status !== 'ready') flushingRef.current = null
    }, [status])

    const prevStatusRef = useRef(status)
    useEffect(() => {
        if (status === 'submitted' && prevStatusRef.current !== 'submitted') {
            track('agent_run_started', { agent_id: agentId })
        }
        prevStatusRef.current = status
    }, [status, agentId])

    const prevRunErrorRef = useRef<string | null>(null)
    useEffect(() => {
        if (runError && !prevRunErrorRef.current && runError !== replayedRunErrorRef.current && classifyChatError(unwrapChatError(runError)) === 'budget') {
            track('agent_run_failed', { agent_id: agentId, error_type: 'budget_exhausted' })
        }
        prevRunErrorRef.current = runError
    }, [runError, agentId])

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const [stopping, setStopping] = useState(false)

    const stopRun = useCallback(async (): Promise<boolean> => {
        setStopping(true)
        try {
            stopStream()
            const runId = activeRunIdRef.current
            const sid = sessionIdRef.current
            activeRunIdRef.current = null
            clearError()
            if (sid) {
                onSessionStatusChange?.(sid, 'idle')
                finalizeSessionAction(sid, 'idle').catch(() => {})
            }
            if (runId) {
                const [, stopped] = await Promise.all([sid ? cancelSessionRunsAction(sid).catch(() => false) : false, cancelRunAction(agentId, runId)])
                return stopped
            }
            return sid ? cancelSessionRunsAction(sid) : false
        } finally {
            setStopping(false)
        }
    }, [stopStream, agentId, onSessionStatusChange, clearError])

    const handleStop = useCallback(() => {
        void stopRun()
    }, [stopRun])

    const submitSpend = useCallback(
        async (decision: SpendDecision) => {
            let granted = decision
            if (decision.always && agentId) {
                const result = await updateAgentConfigAction(agentId, { paidDataAlwaysAllow: true })
                if (!result.success) {
                    toast.error(t('alwaysAllowFailed'))
                    granted = { purpose: decision.purpose, decision: 'approved' }
                }
            }
            sendMessage({ text: serializeSpendDecision(granted) })
        },
        [agentId, sendMessage, t]
    )

    const dismissHitl = useCallback(
        (toolCallId: string) => {
            setDismissedHitlCallId(toolCallId)
            void stopRun()
        },
        [stopRun]
    )

    const sendQueuedNow = useCallback(async () => {
        if (!queued) return
        setRunError(null)
        const stopped = await stopRun()
        if (!stopped) toast.error(t('stopFailed'))
    }, [queued, stopRun, setRunError, t])

    useEffect(() => {
        if (!error) return
        const inFlight = installInFlightOf(error.message)
        if (!inFlight) return
        lastSentTextRef.current = null
        setMessages([])
        clearError()
        onOpenInstall?.(inFlight.sessionId)
    }, [error, setMessages, clearError, onOpenInstall])

    useEffect(() => {
        if (!error) return
        if (classifyChatError(unwrapChatError(error.message)) !== 'run_in_flight') return
        const text = lastSentTextRef.current
        lastSentTextRef.current = null
        if (!text) return
        const teammateRun = teammateRunOf(error.message)
        if (lastSendQueuedRef.current || teammateRun) {
            lastSendQueuedRef.current = false
            enqueueMessage(text, teammateRun?.runId ?? activeRunIdRef.current)
            return
        }
        composerRef.current?.restore(text)
    }, [error, enqueueMessage])

    const [modelReady, setModelReady] = useState(true)
    const [hasOwnConnection, setHasOwnConnection] = useState(true)
    const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
    const [refusedModel, setRefusedModel] = useState<string | null>(null)
    const openAiProviders = useWorkspaceSettingsStore(state => state.openAiProviders)
    const manageModels = useCallback(() => {
        openAiProviders()
    }, [openAiProviders])
    const requestModelPicker = useModelPickerStore(state => state.request)
    const switchModel = useCallback(() => requestModelPicker(uid), [requestModelPicker, uid])
    const reconnectAiProvider = useWorkspaceSettingsStore(state => state.reconnectAiProvider)
    const reconnectProvider = useCallback(() => {
        if (activeConnectionId && activeConnectionId !== RERUN_CONNECTION_ID) reconnectAiProvider(activeConnectionId)
        else openAiProviders()
    }, [activeConnectionId, openAiProviders, reconnectAiProvider])
    const connectSubscription = useCallback(() => {
        track('connection_cta_clicked', { source: 'chat_composer' })
        manageModels()
    }, [manageModels])
    const addAiProvider = useWorkspaceSettingsStore(state => state.addAiProvider)
    const { connections, boxDefault } = useWorkspaceConnections()
    const ownConnection = useMemo(() => {
        const own = connections.filter(connection => connection.connected && connection.id !== RERUN_CONNECTION_ID)
        return own.find(connection => connection.id === boxDefault?.connectionId) ?? own[0] ?? null
    }, [connections, boxDefault])
    const premiumAllowed = !workspace || isPremiumModelEntitled(workspace)
    const tConnections = useTranslations('connections')
    const runOnOwnConnection = useMemo(() => {
        if (!ownConnection) return undefined
        const onUse = () => {
            track('connection_cta_clicked', { source: 'budget_notice_use_connection' })
            if (boxDefault?.connectionId === ownConnection.id) selectModel({})
            else selectModel({ connectionId: ownConnection.id, model: toGroup(ownConnection, premiumAllowed, tConnections).defaultModel })
            setRunError(null)
            clearError()
        }
        return { label: ownConnection.name, provider: ownConnection.provider, onUse }
    }, [ownConnection, boxDefault, premiumAllowed, tConnections, selectModel, clearError])
    const connectProvider = useCallback(
        (provider: 'claude' | 'codex') => {
            track('connection_cta_clicked', { source: `budget_notice_${provider}` })
            addAiProvider(provider)
        },
        [addAiProvider]
    )
    const [hintArmed, setHintArmed] = useState(false)
    const showModelHint = hintArmed && !modelReady
    const modelHint = showModelHint ? <p className="text-xs text-destructive">{refusedModel ?? t('selectModel')}</p> : null
    const blockSend = useCallback(() => {
        setHintArmed(true)
        if (refusedModel) switchModel()
    }, [refusedModel, switchModel])

    useEffect(() => {
        if (initialRunId) setAttachRunId(initialRunId)
    }, [initialRunId])

    useEffect(() => {
        if (!active || !sessionId || !sessionWorking || attachRunId || status !== 'ready') return
        if (snapshotPendingFor === sessionId) return
        if (activeRunIdRef.current) return
        let cancelled = false
        fetchSessionActiveRun(sessionId)
            .then(runId => {
                if (!cancelled && runId) setAttachRunId(runId)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [active, sessionId, sessionWorking, attachRunId, status, snapshotPendingFor])

    const messagesRef = useRef(messages)
    useEffect(() => {
        messagesRef.current = messages
    }, [messages])

    useEffect(() => {
        if (!attachRunId || !active || !sessionId || attachedRunRef.current === attachRunId) return
        attachedRunRef.current = attachRunId
        historyLoadedRef.current = sessionId
        activeRunIdRef.current = attachRunId
        if (proposalsLoadedRef.current !== sessionId) {
            proposalsLoadedRef.current = sessionId
            refreshProposalsRef.current().catch(() => {})
        }
        const wait = () => new Promise(r => setTimeout(r, 600))
        ;(async () => {
            setHistoryLoading(true)
            try {
                for (let i = 0; i < 5; i++) {
                    const data = await fetchSessionMessages(sessionId).catch(() => [])
                    if (data.length > 0) {
                        if (mountedRef.current) setMessages(data as Parameters<typeof setMessages>[0])
                        break
                    }
                    await wait()
                }
            } finally {
                if (mountedRef.current) setHistoryLoading(false)
            }
            if (!mountedRef.current) return
            const run = await getRunAction(agentId, attachRunId).catch(() => null)
            if (!mountedRef.current) return
            if (run?.status === 'error' && run.error && sessionIdRef.current === sessionId) showReplayedRunError(run.error)
            if (!run || run.status === 'running') await resumeStream().catch(() => {})
            for (let i = 0; i < 5 && mountedRef.current; i++) {
                const data = await fetchSessionMessages(sessionId).catch(() => [])
                if (!mountedRef.current || sendingRef.current) return
                const live = messagesRef.current
                if (!needsReconcile(live)) return
                if (historyCovers(live, data)) {
                    setMessages(data as Parameters<typeof setMessages>[0])
                    return
                }
                await wait()
            }
        })()
    }, [attachRunId, initialRunId, active, sessionId, agentId, resumeStream, setMessages, showReplayedRunError])

    const handleRegenerate = useCallback((messageId: string) => regenerate({ messageId }), [regenerate])
    const messageFeedback = useMessageFeedback(sessionId)
    const continueInterruptedRun = useCallback(() => sendMessage({ text: t('continueWhereLeftOff') }), [sendMessage, t])

    const priceArm = usePriceArm()
    const [resumeAfterUpgrade, setResumeAfterUpgrade] = useState(false)
    const [resumeStalled, setResumeStalled] = useState(false)
    const pickTaskBackUp = useCallback(() => {
        setResumeAfterUpgrade(false)
        setRunError(null)
        clearError()
        continueInterruptedRun()
    }, [clearError, continueInterruptedRun])
    const upgradeLanded = workspace?.subscription_status !== 'trialing' && creditHasRoom
    useEffect(() => {
        if (resumeAfterUpgrade && upgradeLanded) pickTaskBackUp()
    }, [resumeAfterUpgrade, upgradeLanded, pickTaskBackUp])
    useEffect(() => {
        if (!resumeAfterUpgrade) return
        const timer = setTimeout(() => setResumeStalled(true), RESUME_STALL_MS)
        return () => clearTimeout(timer)
    }, [resumeAfterUpgrade])
    useEffect(() => {
        setResumeAfterUpgrade(false)
    }, [sessionId])
    const trialUpgrade = {
        coworker: agentName,
        priceArm,
        onPaid: () => {
            setResumeStalled(false)
            setResumeAfterUpgrade(true)
        },
        resuming: resumeAfterUpgrade,
        onResumeNow: resumeStalled ? pickTaskBackUp : undefined,
    }
    const retryLastTurn = useCallback(() => {
        if (sendingRef.current || status === 'submitted' || status === 'streaming') return
        sendingRef.current = true
        lastSentTextRef.current = null
        lastSendQueuedRef.current = false
        void regenerate()
    }, [regenerate, status])
    const canRetry = messages.some(message => message.role === 'user')

    const enqueueFromComposer = useCallback(
        (text: string) => {
            if (browserPermission() === 'default') askNotificationPermission()
            enqueueMessage(text, activeRunIdRef.current)
            conversationRef.current?.scrollToBottom()
        },
        [askNotificationPermission, enqueueMessage]
    )

    const messageTimes = useMessageTimes(messages)
    const lastAssistant = messages.findLastIndex(message => message.role === 'assistant')
    const timeBreaks = useMemo(() => timeBreaksOf(messageTimes), [messageTimes])
    const threadRows = useMemo(() => threadsByMessage(messageTimes, threads ?? []), [messageTimes, threads])
    const threadBranches = (rows: ThreadRow[] | undefined) => rows?.map(thread => <ThreadBranch key={thread.id} thread={thread} onOpen={() => onOpenThread?.(thread.id, thread.title)} />)
    const authorTurns = useMemo(() => splitTurnsAtBreaks(authorTurnsOf(messages), timeBreaks), [messages, timeBreaks])
    const authorIds = useMemo(() => [...new Set(authorTurns.flatMap(turn => (turn.authorId ? [turn.authorId] : [])))], [authorTurns])
    const profileOf = useMemberProfiles(workspace?.id, authorIds)

    const displayedError = runError || (error && !reconnecting) ? unwrapChatError(runError ?? error?.message) : null
    const errorKind = displayedError === null ? null : classifyChatError(displayedError)
    const outOfPaidCredit = useMemo(() => turnRanOutOfPaidCredit(messages), [messages])
    const paidSourcesByTurn = useMemo(() => paidDataSourcesByTurn(messages), [messages])

    const canFlush = shouldFlush({ queued, busy: showLoader || stopping, uploading, status, hasError: displayedError !== null })
    useEffect(() => {
        if (!canFlush || !queued || flushingRef.current) return
        flushingRef.current = queued.id
        if (!sendMessage({ text: queued.text }, { body: { queued: true } })) {
            flushingRef.current = null
            return
        }
        clearQueued()
        onMessageSentRef.current?.()
    }, [canFlush, queued, clearQueued, sendMessage])

    useEffect(() => {
        if (!active || !queued || queued.id !== restoredQueuedId || flushingRef.current || stopping) return
        const activeRunId = attachRunId ?? activeRunIdRef.current
        if (activeRunId === null && showLoader) return
        if (shouldKeepQueued(queued, activeRunId)) return
        if (!composerRef.current?.restore(queued.text)) return
        clearQueued()
    }, [queued, restoredQueuedId, active, attachRunId, showLoader, stopping, clearQueued])

    const footerVisible = !pendingHitl || !!pendingAlert || skillProposals.pinned.length > 0

    const takeoverAsk = pendingHitl?.kind === 'takeover' ? { callId: pendingHitl.toolCallId, request: pendingTakeover(pendingHitl.input) } : null
    const runOnScreen = useMemo(() => runUsesScreen(messages), [messages])
    const screenShown = (showLoader && runOnScreen) || !!takeoverAsk
    const activityLoader = showLoader && !stepGroupShowsActivity(messages.at(-1)) ? <ChatActivityLoader agentId={agentId} message={messages.at(-1)} indicator={<AgentBuddy agentId={agentId} mood="working" size={24} facing="right" />} /> : null

    return (
        <div ref={chatRootRef} data-chat-scrolled={active && scrollEdges.top > 0 ? '' : undefined} className="relative flex flex-1 flex-col overflow-hidden">
            {header}
            <Conversation className="flex-1" contextRef={conversationRef} initial="instant" resize={status === 'streaming' || status === 'submitted' ? 'smooth' : 'instant'}>
                <div className="h-full" style={{ maskImage: scrollMask, WebkitMaskImage: scrollMask }}>
                    <ConversationContent>
                        {historyLoading && <SkeletonChat className="py-2" />}
                        {threadRows.leading.length > 0 && !historyLoading && <div className="flex flex-col gap-3">{threadBranches(threadRows.leading)}</div>}
                        {messages.length === 0 && threadRows.leading.length === 0 && !suppressEmptyState && !historyLoading && !showInstallGate && (
                            <ConversationEmptyState>
                                <AgentBuddy agentId={agentId} mood={buddyMood} size={96} />
                                <div className="space-y-1">
                                    <h3 className="font-medium text-sm">{t('emptyTitle')}</h3>
                                    <p className="text-muted-foreground text-sm">{t('emptyDescription')}</p>
                                </div>
                                <Suggestions className="mt-2 justify-center">
                                    {COWORKER_STARTER_SUGGESTIONS.map(s => (
                                        <Suggestion key={s} suggestion={s} onClick={text => sendMessage({ text })} />
                                    ))}
                                </Suggestions>
                            </ConversationEmptyState>
                        )}
                        {authorTurns.map(turn => {
                            const views = turn.items.map(({ message, index: mi }) => {
                                const isLast = mi === messages.length - 1
                                const isActive = isLast && (status === 'streaming' || status === 'submitted')
                                const hitlCall = hitlCallBefore(messages, mi)
                                const spendReply = hitlCallKind(hitlCall) === 'spend'
                                const branches = threadBranches(threadRows.after.get(mi))
                                const view = (
                                    <MessageView
                                        key={message.id}
                                        message={message}
                                        isActive={isActive}
                                        isLastAssistant={mi === lastAssistant}
                                        agentId={agentId}
                                        pendingHitlToolCallId={pendingHitl?.toolCallId}
                                        pendingMcpSignIn={pendingHitl?.kind === 'mcp' ? pendingMcpSignIn(pendingHitl.input).name : undefined}
                                        hitlCall={hitlCall}
                                        spentMicros={spendReply ? spentAfter(messages, mi) : undefined}
                                        spendRunning={spendReply && (status === 'streaming' || status === 'submitted') && isLatestUserMessage(messages, mi)}
                                        pendingAlertToolCallId={pendingAlert?.toolCallId ?? undefined}
                                        activeRunId={activeRunIdRef.current}
                                        onSendMessage={sendMessage}
                                        onDraftReply={draftReply}
                                        showQuickReplies={isLast && !showLoader && !pendingHitl && !pendingAlert && displayedError === null}
                                        onRegenerate={isLast && pendingHitl ? undefined : handleRegenerate}
                                        onRateMessage={sessionId ? messageFeedback.rate : undefined}
                                        feedbackRating={messageFeedback.votes.get(message.id)?.rating ?? null}
                                        skillProposals={skillProposals.proposals}
                                        decidingProposalId={skillProposals.pendingId}
                                        onDecideProposal={skillProposals.decide}
                                        pinnedProposalIds={skillProposals.pinnedIds}
                                        installing={setup?.pending === true}
                                        mentions={mentionTokens}
                                        createdAt={messageTimes[mi]}
                                        paidSources={paidSourcesByTurn.get(message.id)}
                                    />
                                )
                                if (!branches?.length) return view
                                return (
                                    <Fragment key={message.id}>
                                        {view}
                                        {branches}
                                    </Fragment>
                                )
                            })
                            const opening = turn.items[0].index
                            return (
                                <Fragment key={turn.key}>
                                    {timeBreaks.has(opening) && <ChatTimeSeparator createdAt={messageTimes[opening]} />}
                                    {turn.authorId ? <AuthoredGroup author={profileOf(turn.authorId)}>{views}</AuthoredGroup> : views}
                                </Fragment>
                            )
                        })}
                        {pendingHitl && pendingHitl.kind !== 'takeover' && (
                            <motion.div key={pendingHitl.toolCallId} ref={pendingHitlRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}>
                                {pendingHitl.kind === 'question' && <QuestionForm inline ref={questionFormRef} target={{ kind: 'agent', agentId }} questions={pendingQuestions(pendingHitl.input)} onSend={text => sendMessage({ text })} onCancel={() => dismissHitl(pendingHitl.toolCallId)} textareaRef={inputRef} textareaProps={mentionTextareaProps} />}
                                {pendingHitl.kind === 'approval' && <ActionApprovalBlock inline approvals={pendingApprovals(pendingHitl.input)} onSubmit={decisions => sendMessage({ text: serializeApprovalDecisions(decisions) })} />}
                                {pendingHitl.kind === 'secret' && agentId && <SecretRequestBlock inline agentId={agentId} sessionId={sessionId ?? null} secrets={pendingSecrets(pendingHitl.input)} reason={typeof pendingHitl.input.reason === 'string' ? pendingHitl.input.reason : undefined} onDone={summary => sendMessage({ text: summary })} onSkip={() => sendMessage({ text: HITL_CANCELLED.secret })} onDismiss={() => dismissHitl(pendingHitl.toolCallId)} />}
                                {pendingHitl.kind === 'spend' && <SpendRequestBlock input={pendingHitl.input} output={pendingHitl.output} onSubmit={decision => void submitSpend(decision)} />}
                                {pendingHitl.kind === 'mcp' && agentId && <McpSignInBlock inline agentId={agentId} {...pendingMcpSignIn(pendingHitl.input)} onDone={summary => sendMessage({ text: summary })} onSkip={() => sendMessage({ text: HITL_CANCELLED.mcp })} />}
                                {pendingHitl.kind === 'service' && agentId && <ServiceSuggestionBlock inline agentId={agentId} services={(Array.isArray(pendingHitl.input.services) ? pendingHitl.input.services : []) as { slug: string; reason?: string }[]} onDone={summary => sendMessage({ text: summary })} />}
                            </motion.div>
                        )}
                        {screenShown && (
                            <ChatScreen
                                agentId={agentId}
                                active={active}
                                site={screenSite(messages, takeoverAsk?.request.url ?? null)}
                                takeoverAsk={takeoverAsk}
                                onTakeoverDone={summary => sendMessage({ text: summary })}
                                onTakeoverSkip={() => sendMessage({ text: HITL_CANCELLED.takeover })}
                                scroller={scroller}
                                floatingHost={chatRoot}
                                arriveRef={takeoverAsk ? pendingHitlRef : undefined}
                                fallback={activityLoader}
                            />
                        )}
                        {!screenShown && activityLoader}
                        {outOfPaidCredit && !showLoader && displayedError === null && (
                            <Message from="assistant">
                                <MessageContent>
                                    <BudgetExhaustedNotice trialing={workspace?.subscription_status === 'trialing' || resumeAfterUpgrade} paused={!!workspace?.rerun_credit_paused_at} noCredit={rerunCredit.budgetMicros === 0} lifetime={isLifetimePlan(workspace)} {...trialUpgrade} />
                                </MessageContent>
                            </Message>
                        )}
                        {displayedError !== null && errorKind !== null && (
                            <Message from="assistant">
                                <MessageContent>{errorKind === 'budget' ? <BudgetExhaustedNotice onConnectProvider={connectProvider} ownConnection={runOnOwnConnection} trialing={workspace?.subscription_status === 'trialing' || resumeAfterUpgrade} paused={!!workspace?.rerun_credit_paused_at} noCredit={rerunCredit.budgetMicros === 0} lifetime={isLifetimePlan(workspace)} {...trialUpgrade} /> : <ProviderErrorNotice kind={errorKind} message={displayedError} onSwitchModel={switchModel} onReconnect={reconnectProvider} onStopRun={handleStop} onContinue={continueInterruptedRun} onRetry={canRetry ? retryLastTurn : undefined} onNewConversation={onNewConversation} />}</MessageContent>
                            </Message>
                        )}
                    </ConversationContent>
                </div>
                <ConversationScrollButton pending={pendingCue} />
            </Conversation>
            <MessageFeedbackDialog open={messageFeedback.dialogOpen} rating={messageFeedback.dialogRating} onOpenChange={messageFeedback.onDialogOpenChange} onSubmit={messageFeedback.submitDetails} />

            {mentionMenu && <div className="absolute inset-x-3" style={{ top: mentionMenuTop }}>{mentionMenu}</div>}
            {footerVisible && (
                <div className="border-t border-border p-3">
                    <AnimatePresence initial={false}>
                        {pendingAlert && (
                            <motion.div key="alert" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }} className="overflow-hidden">
                                <AlertBlock message={pendingAlert.message} at={alertAt?.sessionId === sessionId ? alertAt.at : null} pending={acknowledging} onAcknowledge={() => void acknowledgeAlert()} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <SkillProposalDock agentId={agentId} proposals={skillProposals.pinned} pendingId={skillProposals.pendingId} onDecide={skillProposals.decide} />
                    <AnimatePresence initial={false} mode="popLayout">
                        {pendingHitl ? null : showInstallGate ? (
                            <motion.div key="install-gate" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }} className="overflow-hidden">
                                <InstallGate
                                    agentId={agentId}
                                    agentName={agentName}
                                    apps={installApps}
                                    inProgress={!!setup?.sessionId && setup.sessionId !== sessionId}
                                    onContinue={() => setup?.sessionId && onOpenInstall?.(setup.sessionId)}
                                    disabled={status === 'streaming' || status === 'submitted'}
                                    hint={modelHint}
                                    modelSlot={<ModelSelector agentId={agentId} pickerKey={uid} onReadyChange={setModelReady} onOwnConnectionChange={setHasOwnConnection} onConnectionChange={setActiveConnectionId} onRefusedModelChange={setRefusedModel} />}
                                    onStart={() => {
                                        if (!modelReady) {
                                            blockSend()
                                            return false
                                        }
                                        track('agent_install_started', { agent_id: agentId })
                                        return sendMessage({ text: buildInstallMessage(setup!.prompt, agentName) })
                                    }}
                                    onSkip={() => {
                                        track('agent_install_skipped', { agent_id: agentId })
                                        onSetupSkipped?.()
                                    }}
                                />
                            </motion.div>
                        ) : (
                            <motion.div key="composer" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }} className="overflow-hidden pb-px">
                                <ChatComposer ref={composerRef} uid={uid} active={active} placeholder={composerPlaceholder} uploadTarget={uploadTarget} status={status} busy={showLoader} onSend={text => sendMessage({ text })} onSent={() => onMessageSentRef.current?.()} onStop={handleStop} onUploadingChange={setUploading} queue={{ text: queued?.text ?? null, pending: stopping, enqueue: enqueueFromComposer, onSendNow: () => void sendQueuedNow(), onDiscard: clearQueued }} gate={{ ready: modelReady, onBlocked: blockSend, hint: modelHint }} modelSlot={<ModelSelector agentId={agentId} pickerKey={uid} onReadyChange={setModelReady} onOwnConnectionChange={setHasOwnConnection} onConnectionChange={setActiveConnectionId} onRefusedModelChange={setRefusedModel} />} contextSlot={contextStats && <Context usedTokens={contextStats.used} maxTokens={contextStats.max ?? modelContextWindow(contextStats.model, contextStats.provider)} usage={contextStats.usage} modelId={contextStats.model} />} textareaRef={inputRef} textareaProps={mentionTextareaProps} mentionTokens={mentionTokens} />
                                <ComposerSubscriptionCta open={!hasOwnConnection} onClick={connectSubscription} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
        </div>
    )
}
