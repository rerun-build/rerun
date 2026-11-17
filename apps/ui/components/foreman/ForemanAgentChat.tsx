'use client'

import { FOREMAN_INTENT_PART, type ForemanIntent, type PendingHitl } from '@rerun/contracts'
import { isWorkspaceApiEntitled } from '@rerun/cloud/billing'
import { PHONE_REQUIRED_MESSAGE } from '@rerun/cloud/phone'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AgentChat, type AgentChatHandle, type AgentChatState } from '@/components/chat/AgentChat'
import type { ToolPartLike } from '@/components/chat/MessageView'
import { ForemanActivityIndicator } from '@/components/foreman/ForemanActivityIndicator'
import { ForemanTeamEmptyStateSlot } from '@/components/foreman/empty-state/ForemanTeamEmptyStateSlot'
import { isForemanClientTool, runForemanClientTool, type ForemanClientGates } from '@/components/foreman/foremanClientTools'
import type { OrbActivity } from '@/components/foreman/Orb'
import { useForemanDockFeed } from '@/components/foreman/useForemanDockFeed'
import { refreshForemanSurface } from '@/components/foreman/useForemanKickoff'
import { useForemanMentionAgents } from '@/components/foreman/useForemanMentionAgents'
import type { ForemanThreads } from '@/components/foreman/useForemanThreads'
import { isAgentShortcutTool, planAgentShortcuts } from '@/components/foreman/widgets/agent-picks'
import { renderForemanWidget } from '@/components/foreman/widgets/renderForemanWidget'
import type { PendingWidget } from '@/lib/foreman/pending-widget'
import { useForemanStore } from '@/stores/foreman.store'
import { useIsWorkspaceAdmin, useSession } from '@/supabase/session/SessionProvider'

const API = '/api/chat/foreman/engine'

// The orb follows the turn: it speaks while text comes out, thinks the rest of the time it works.
function orbActivityOf(state: AgentChatState): OrbActivity {
    if (!state.streaming) return 'idle'
    const tail = state.messages.at(-1)?.parts.at(-1)
    return tail?.type === 'text' && tail.state === 'streaming' ? 'speaking' : 'thinking'
}

// The parked Foreman holds up a question or an approval it waits on, as it did before.
function pendingWidgetOf(pending: PendingHitl | null): PendingWidget | null {
    if (pending?.kind === 'question') return { toolName: 'ask_user', toolCallId: pending.toolCallId, input: pending.input }
    if (pending?.kind === 'approval') return { toolName: 'request_approval', toolCallId: pending.toolCallId, input: pending.input }
    return null
}

const noAnswer = () => {}

type ForemanAgentChatProps = {
    agentRowId: string
    threads: ForemanThreads
    open: boolean
    orbPaused: boolean
    header: React.ReactNode
    composerPlaceholder?: string
}

/**
 * The Chief of Staff's conversation past its onboarding: a coworker's chat, every card included,
 * sent through its own route, which writes its brief for the turn and keeps one General per member.
 * Around it stays what only it has: the gestures it makes on the board, the rows that lead to the
 * coworkers it touched, the orb and the parked pill.
 */
export function ForemanAgentChat({ agentRowId, threads, open, orbPaused, header, composerPlaceholder }: ForemanAgentChatProps) {
    const t = useTranslations('workspaceView.foreman')
    const sessionId = useForemanStore(state => state.sessionId)
    const generalId = useForemanStore(state => state.generalId)
    const draftId = useForemanStore(state => state.draftId)
    const engaged = useForemanStore(state => state.engaged)
    const { workspace } = useSession()
    const isAdmin = useIsWorkspaceAdmin()
    const mentionAgents = useForemanMentionAgents()

    const isGeneral = sessionId === generalId
    const { general, loaded, statusOf } = threads

    // General opens on the member's own once the server has named it; until they speak in it there is
    // none, and the first message creates it under the id this tab made up.
    const generalRowId = general?.id ?? null
    useEffect(() => {
        const store = useForemanStore.getState()
        if (generalRowId && store.sessionId === store.generalId && store.generalId !== generalRowId) store.setGeneral(generalRowId, 'engine')
    }, [generalRowId])
    const [created, setCreated] = useState<ReadonlySet<string>>(() => new Set())
    const known = isGeneral ? generalRowId === sessionId || created.has(sessionId) : draftId !== sessionId || created.has(sessionId)

    const onSessionCreated = useCallback((id: string) => {
        setCreated(previous => new Set(previous).add(id))
        useForemanStore.getState().adoptSession(id)
    }, [])

    const body = useMemo(() => ({ kind: isGeneral ? 'general' : 'thread', ...(known ? {} : { sessionId }) }), [isGeneral, known, sessionId])

    // A gesture of the run on the board: a panel to open, a coworker to show. Its tool already
    // answered on the engine, so what the browser makes of it goes nowhere.
    const gates = useRef<ForemanClientGates>({ apiEntitled: false, isSandbox: false, isAdmin: false })
    useEffect(() => {
        gates.current = { apiEntitled: !!workspace && isWorkspaceApiEntitled(workspace), isSandbox: !!workspace?.is_sandbox, isAdmin }
    }, [workspace, isAdmin])
    const onData = useCallback((part: { type: string; data: unknown }) => {
        if (part.type !== FOREMAN_INTENT_PART) return
        const { tool, input } = part.data as ForemanIntent
        if (isForemanClientTool(tool)) runForemanClientTool(tool, input, gates.current)
    }, [])

    // The latest transcript, read by the shortcut rows when a message draws: kept off the props so a
    // token streaming in does not render the whole chat a second time from here.
    const latest = useRef<AgentChatState | null>(null)
    const sync = useRef<((state: AgentChatState) => void) | null>(null)
    const onChatState = useCallback((state: AgentChatState) => {
        latest.current = state
        sync.current?.(state)
    }, [])
    const renderToolPart = useCallback((part: ToolPartLike) => (isAgentShortcutTool(part.toolName) ? renderForemanWidget(part, noAnswer, undefined, planAgentShortcuts(latest.current?.messages ?? [])) : undefined), [])

    const handle = useRef<AgentChatHandle | null>(null)
    const focusRequest = useForemanStore(state => state.composerFocusRequest)
    const handledFocusRequest = useRef(focusRequest)
    useEffect(() => {
        if (handledFocusRequest.current === focusRequest) return
        handledFocusRequest.current = focusRequest
        if (open) handle.current?.focus()
    }, [focusRequest, open])

    const openThread = useCallback((id: string) => useForemanStore.getState().openThread(id), [])
    const emptyState = useMemo(() => <ForemanTeamEmptyStateSlot onSend={text => void handle.current?.send(text)} onPrefill={text => handle.current?.prefill(text)} orbPaused={orbPaused} />, [orbPaused])
    const status = statusOf(sessionId)

    return (
        <>
        <ForemanChatSync syncRef={sync} open={open} isGeneral={isGeneral} handle={handle} />
        <AgentChat
            key={isGeneral ? 'general' : sessionId}
            uid={`foreman-${isGeneral ? 'general' : sessionId}`}
            handleRef={handle}
            active={open || engaged}
            agentId={agentRowId}
            agentName={t('name')}
            sessionId={known ? sessionId : null}
            sessionPending={isGeneral && !loaded}
            onSessionCreated={onSessionCreated}
            api={API}
            body={body}
            sessionWorking={status === 'working'}
            alertPending={status === 'awaiting_ack'}
            sessionIdle={status === 'idle'}
            mentionAgents={mentionAgents}
            threads={isGeneral ? threads.threads : undefined}
            onOpenThread={openThread}
            header={header}
            composerPlaceholder={composerPlaceholder}
            emptyState={emptyState}
            activityIndicator={<ForemanActivityIndicator />}
            onData={onData}
            renderToolPart={renderToolPart}
            feedbackScope="foreman"
            onChatState={onChatState}
        />
        </>
    )
}

// What follows the conversation without drawing it: the orb, the parked pill, a route that turned
// the message away, a prompt handed from outside the column. Its own state, so the chat beside it
// renders only for itself.
function ForemanChatSync({ syncRef, open, isGeneral, handle }: { syncRef: React.RefObject<((state: AgentChatState) => void) | null>; open: boolean; isGeneral: boolean; handle: React.RefObject<AgentChatHandle | null> }) {
    const { refreshPhoneStep } = useSession()
    const [chat, setChat] = useState<AgentChatState | null>(null)
    useEffect(() => {
        syncRef.current = setChat
        return () => {
            syncRef.current = null
        }
    }, [syncRef])

    const activity = chat ? orbActivityOf(chat) : 'idle'
    useEffect(() => {
        useForemanStore.getState().setActivity(activity)
    }, [activity])
    useForemanDockFeed({ messages: chat?.messages ?? [], busy: chat?.busy ?? false, open, pending: pendingWidgetOf(chat?.pending ?? null), failed: !!chat?.error })

    // The route turned the message away because the workspace moved on under this tab (the
    // onboarding came back, the machine went away), or the phone wall was missed: asked again, the
    // column follows.
    const error = chat?.error ?? null
    useEffect(() => {
        if (error && /onboarding_over|foreman_unavailable/.test(error)) void refreshForemanSurface()
        if (error?.includes(PHONE_REQUIRED_MESSAGE)) void refreshPhoneStep()
    }, [error, refreshPhoneStep])

    // A prompt handed from outside the column (the pill, the checklist) lands in General once its
    // history is in and nothing runs.
    const pendingPrompt = useForemanStore(state => state.pendingPrompt)
    const ready = !!chat?.historyReady && !chat.busy
    useEffect(() => {
        if (!pendingPrompt || !ready || !isGeneral) return
        if (handle.current?.send(pendingPrompt)) useForemanStore.getState().clearPendingPrompt()
    }, [pendingPrompt, ready, isGeneral, handle])

    return null
}
