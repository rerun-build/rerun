import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, type AgentModels, type Conversation, type ForemanSurface } from '@rerun/contracts'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { fetchForemanEngineFiles, fetchForemanSurface } from '@/api/foreman'
import { fetchAgentModels } from '@/api/models'
import { useAuth } from '@/auth/AuthProvider'
import { takePendingAsk } from '@/chat/pending-ask'
import { foremanEndpoints } from '@/chat/endpoints'
import { useChatBack } from '@/components/layout/useChatBack'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { PillButton } from '@/components/ui/PillButton'
import { environment, webHost } from '@/config/environment'
import { cachedForeman } from '@/data/local-cache'
import * as Haptics from '@/lib/haptics'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import { CHAT_HEADER_HEIGHT, ChatHeader, type ChatTab } from './ChatHeader'
import { CONTROL } from './ComposerControls'
import { activePageIndex, conversationPages, GENERAL_DRAFT_KEY, GENERAL_PAGE_ID, type ConversationPage } from './conversation-pages'
import { ConversationPager } from './ConversationPager'
import { BLUR_ABOVE_FOOTER, ConversationPane, type ChatCoworker } from './ConversationPane'
import { ConversationSkeleton } from './ConversationSkeleton'
import { generalThreadsOf } from './threads/general-threads'
import { useForemanConversations } from './useCoworkerConversations'
import { useOpenChats } from './useOpenChats'

// Opens the Foreman's General, the conversation the web column opens on. Older links and pushes say `last`.
export const LAST_CONVERSATION = 'last'

const FOREMAN: Omit<ChatCoworker, 'role'> = { id: FOREMAN_AGENT_ID, kind: 'foreman', name: FOREMAN_DISPLAY_NAME, status: 'idle' }

const tabOf = (conversation: Conversation): ChatTab | null => (conversation.id ? { id: conversation.id, title: conversation.title, running: conversation.status === 'working', empty: false, status: conversation.status, updatedAt: conversation.updatedAt, kind: conversation.kind } : null)

type SurfaceState = ForemanSurface | 'loading' | 'error'


// Where the pane's transcript rests above its composer, so the conversation that replaces this
// skeleton lands where it already stood.
const COMPOSER_AREA = CONTROL + spacing.sm * 3 + BLUR_ABOVE_FOOTER

function LoadingConversation() {
    const insets = useSafeAreaInsets()
    return (
        <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.xl - 4, paddingTop: insets.top + CHAT_HEADER_HEIGHT + spacing.lg, paddingBottom: insets.bottom + COMPOSER_AREA }}>
            <ConversationSkeleton />
        </View>
    )
}

function Notice({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
    const insets = useSafeAreaInsets()
    const t = useTranslations('mobileChat.foreman')
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingTop: insets.top + CHAT_HEADER_HEIGHT, paddingBottom: insets.bottom + spacing.xxl }}>
            <ForemanOrb size={64} />
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
                <AppText variant="title" style={{ textAlign: 'center' }}>
                    {title}
                </AppText>
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    {body}
                </AppText>
            </View>
            {onRetry && <PillButton label={t('retry')} variant="secondary" onPress={onRetry} />}
        </View>
    )
}

// The Foreman of the workspace, the one running on its machine, on a page of its own like a coworker:
// General pinned first, the threads it opened, a new thread at the end of the row. The onboarding's
// lives on the web: a workspace still in it is sent there. `sessionId` is null for a new thread, or
// `last` / `general` for General. What the search asks lands in General.
export function ForemanChat({ sessionId }: { sessionId: string | null }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.foreman')
    const foreman = useMemo<ChatCoworker>(() => ({ ...FOREMAN, role: t('role') }), [t])
    const back = useChatBack()
    const { session, me } = useAuth()
    const opensGeneral = sessionId === LAST_CONVERSATION || sessionId === GENERAL_PAGE_ID
    const [ask] = useState(() => (opensGeneral ? takePendingAsk() : undefined))
    // Where the last visit found the Foreman: the page opens on it.
    const [kept] = useState(() => (me ? cachedForeman(me.workspace.id).read() : null))
    const [surface, setSurface] = useState<SurfaceState>(kept?.surface ?? 'loading')
    const [attempt, setAttempt] = useState(0)
    const { conversations, loaded: conversationsLoaded, reload: loadConversations } = useForemanConversations()
    const [draftKey, setDraftKey] = useState(() => `new-${Date.now()}`)
    const [bornKeys, setBornKeys] = useState<Record<string, string>>({})
    const [activeId, setActiveId] = useState(opensGeneral ? GENERAL_PAGE_ID : sessionId)
    const [models, setModels] = useState<AgentModels | null>(null)
    const [filesOnEngine, setFilesOnEngine] = useState(false)
    // Read by the pages' endpoints at upload time, long after the render that built them.
    const filesOnEngineRef = useRef(false)
    const [openIds, openChat] = useOpenChats(FOREMAN_AGENT_ID, opensGeneral ? null : sessionId)
    const generalId = conversations.find(conversation => conversation.kind === 'general')?.id ?? null
    const generalThreads = useMemo(() => generalThreadsOf(conversations), [conversations])
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const signedIn = Boolean(accessToken)

    // A refreshed token is not a new request: following it would remount the conversation and lose
    // its draft.
    const latestToken = useRef(accessToken)
    useEffect(() => {
        latestToken.current = accessToken
    }, [accessToken])

    const open = (id: string) => {
        if (id !== GENERAL_PAGE_ID && id !== generalId) openChat(id)
        setActiveId(id)
        router.setParams({ id })
    }

    const showDraft = () => {
        setActiveId(null)
        router.setParams({ id: 'new' })
    }

    useEffect(() => {
        const token = latestToken.current
        if (!signedIn || !token || !workspaceId) return
        let cancelled = false
        fetchForemanSurface({ accessToken: token, workspaceId })
            .then(next => {
                if (cancelled) return
                cachedForeman(workspaceId).save({ surface: next, last: kept?.last ?? null })
                setSurface(next)
            })
            // Offline, the page stays on what the phone knew.
            .catch(() => {
                if (!cancelled) setSurface(current => (kept && current !== 'loading' ? current : 'error'))
            })
        return () => {
            cancelled = true
        }
    }, [signedIn, workspaceId, attempt, kept])

    // Read again when the model sheet closes on a new pick, as a coworker's page does.
    useFocusEffect(
        useCallback(() => {
            const token = latestToken.current
            if (surface !== 'engine' || !token || !workspaceId) return
            fetchAgentModels({ accessToken: token, workspaceId }, FOREMAN_AGENT_ID)
                .then(setModels)
                .catch(() => {})
        }, [surface, workspaceId])
    )

    useEffect(() => {
        const token = latestToken.current
        if (surface !== 'engine' || !token || !workspaceId) return
        let cancelled = false
        fetchForemanEngineFiles({ accessToken: token, workspaceId })
            .then(supported => {
                if (cancelled) return
                filesOnEngineRef.current = supported
                setFilesOnEngine(supported)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [surface, workspaceId])

    const makeEndpoints = useCallback((general: boolean) => foremanEndpoints(() => filesOnEngineRef.current, { general }), [])

    // A pick in the header ticks on the tap; a swipe has already ticked as it crossed into the page.
    const select = (id: string) => {
        Haptics.selectionAsync()
        open(id)
    }

    const startNew = () => {
        Haptics.selectionAsync()
        showDraft()
    }

    // Born from its first send: the page stays and becomes a tab, and a fresh draft ends the row.
    const onSessionCreated = useCallback(
        (id: string) => {
            setBornKeys(known => ({ ...known, [id]: draftKey }))
            setDraftKey(`new-${Date.now()}`)
            openChat(id)
            setActiveId(id)
            router.setParams({ id })
            loadConversations()
        },
        [draftKey, openChat, loadConversations]
    )

    // General born on its own page: it keeps that page, and stays the active one under its own id
    // once the list names it.
    const onGeneralCreated = useCallback(
        (id: string) => {
            setBornKeys(known => ({ ...known, [id]: GENERAL_DRAFT_KEY }))
            router.setParams({ id })
            loadConversations()
        },
        [loadConversations]
    )

    const pages = conversationPages(openIds, bornKeys, draftKey, { sessionId: generalId })
    const activeIndex = activePageIndex(pages, activeId)
    const shownId = activeId === GENERAL_PAGE_ID && generalId ? generalId : activeId
    const progress = useSharedValue(activeIndex)

    const settleOn = (index: number) => {
        const sessionAt = pages[index]?.sessionId
        if (sessionAt === undefined) return
        if (pages[index]?.general) open(sessionAt ?? GENERAL_PAGE_ID)
        else if (sessionAt) open(sessionAt)
        else showDraft()
    }

    const byId = new Map(conversations.map(conversation => [conversation.id, conversation]))
    // One chip per page, even before the hub names the conversation, so the strip lines up with the pager.
    const tabs = pages.slice(0, -1).map((page): ChatTab => {
        const conversation = page.sessionId ? byId.get(page.sessionId) : undefined
        const tab = conversation && tabOf(conversation)
        if (page.general) return tab ? { ...tab, kind: 'general' } : { id: GENERAL_PAGE_ID, title: null, running: false, empty: true, kind: 'general' }
        return tab || { id: page.sessionId ?? page.key, title: null, running: false, empty: false, loading: !conversationsLoaded }
    })
    const allTabs = conversations.map(tabOf).filter((tab): tab is ChatTab => tab !== null)

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            {surface === 'loading' && <LoadingConversation />}
            {surface === 'engine' && (
                <ConversationPager
                    pages={pages}
                    activeIndex={activeIndex}
                    progress={progress}
                    onSettle={settleOn}
                    renderPage={(page: ConversationPage, onScreen) => (
                        <ConversationPane
                            coworker={foreman}
                            makeEndpoints={() => makeEndpoints(!!page.general)}
                            initialSessionId={page.sessionId}
                            onSessionCreated={page.general ? onGeneralCreated : onSessionCreated}
                            models={models}
                            status={(page.sessionId && byId.get(page.sessionId)?.status) || null}
                            onStatusChange={loadConversations}
                            webUrl={`${environment.apiUrl}/`}
                            onScreen={onScreen}
                            initialMessage={page.general ? ask : undefined}
                            canAttach={filesOnEngine}
                            threads={page.general ? generalThreads : undefined}
                            onOpenThread={select}
                        />
                    )}
                />
            )}
            {(surface === 'onboarding' || surface === 'none') && <Notice title={t(`away.${surface}.title`)} body={t(`away.${surface}.body`, { host: webHost })} />}
            {surface === 'error' && (
                <Notice
                    title={t('unreachableTitle')}
                    body={t('unreachableBody')}
                    onRetry={() => {
                        setSurface('loading')
                        setAttempt(current => current + 1)
                    }}
                />
            )}
            <ChatHeader coworker={foreman} tabs={surface === 'engine' ? tabs : []} activeId={shownId ?? undefined} progress={progress} allSessions={surface === 'engine' ? allTabs : []} onBack={back} onSelect={select} onNewSession={startNew} />
        </View>
    )
}
