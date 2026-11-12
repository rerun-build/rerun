import type { AgentModels, AgentView, Conversation } from '@rerun/contracts'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'

import { fetchAgentView } from '@/api/chat'
import { markInboxRead } from '@/api/inbox'
import { fetchAgentModels } from '@/api/models'
import { useAuth } from '@/auth/AuthProvider'
import { coworkerEndpoints } from '@/chat/endpoints'
import { useChatBack } from '@/components/layout/useChatBack'
import { environment } from '@/config/environment'
import { readCoworkerScreen, saveCoworkerScreen } from '@/data/local-cache'
import * as Haptics from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

import { ChatHeader, type ChatTab } from './ChatHeader'
import { stateOf } from './conversation-sections'
import { activePageIndex, conversationPages, GENERAL_DRAFT_KEY, GENERAL_PAGE_ID, type ConversationPage } from './conversation-pages'
import { ConversationPager } from './ConversationPager'
import { ConversationPane, type ChatCoworker } from './ConversationPane'
import { generalThreadsOf } from './threads/general-threads'
import type { StartedBy } from './origins/StartedByBanner'
import { useCoworkerConversations } from './useCoworkerConversations'
import { useOpenChats } from './useOpenChats'

function coworkerOf(agentId: string, view: AgentView | null): ChatCoworker {
    const agent = view?.agent
    return { id: agentId, kind: 'coworker', name: agent?.name ?? '', role: agent?.description ?? '', status: agent?.disabledAt ? 'offline' : (agent?.status ?? 'idle') }
}

const tabOf = (conversation: Conversation): ChatTab | null => (conversation.id ? { id: conversation.id, title: conversation.title, running: conversation.status === 'working', empty: false, status: conversation.status, unseen: conversation.unseen, ask: conversation.ask, automationName: conversation.automationName, updatedAt: conversation.updatedAt, kind: conversation.kind } : null)

// A coworker's conversations, on the hub. `sessionId` is null for a new one: the first send creates it,
// and the page keeps its chat while the route learns the new id.
function startedByOf(conversation: Conversation | undefined): StartedBy | null {
    return conversation?.originAgentName ? { agentId: conversation.originAgentId ?? null, name: conversation.originAgentName } : null
}

export function CoworkerChat({ agentId, sessionId }: { agentId: string; sessionId: string | null }) {
    const theme = useTheme()
    const back = useChatBack()
    const { session, me } = useAuth()
    // The header opens on what the last visit read: name, tabs and model are there before the hub answers.
    const [kept] = useState(() => (me ? readCoworkerScreen(me.workspace.id, agentId) : null))
    const [view, setView] = useState<AgentView | null>(kept?.view ?? null)
    const [models, setModels] = useState<AgentModels | null>(kept?.models ?? null)
    const { conversations, loaded: conversationsLoaded, reload: loadConversations } = useCoworkerConversations(agentId)
    const [draftKey, setDraftKey] = useState(() => `new-${Date.now()}`)
    const [bornKeys, setBornKeys] = useState<Record<string, string>>({})
    const [activeId, setActiveId] = useState(sessionId)
    const [openIds, openChat] = useOpenChats(agentId, sessionId === GENERAL_PAGE_ID ? null : sessionId)
    const coworker = coworkerOf(agentId, view)
    const generalId = conversations.find(conversation => conversation.kind === 'general')?.id ?? null
    const generalThreads = useMemo(() => generalThreadsOf(conversations), [conversations])
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    // Read again when the model sheet closes on a new pick, or the details come back on a new name.
    useFocusEffect(
        useCallback(() => {
            if (!accessToken || !workspaceId) return
            fetchAgentView({ accessToken, workspaceId }, agentId)
                .then(fetched => {
                    setView(fetched)
                    saveCoworkerScreen(workspaceId, agentId, { view: fetched })
                })
                .catch(() => {})
            fetchAgentModels({ accessToken, workspaceId }, agentId)
                .then(fetched => {
                    setModels(fetched)
                    saveCoworkerScreen(workspaceId, agentId, { models: fetched })
                })
                .catch(() => {})
        }, [accessToken, workspaceId, agentId])
    )

    // On screen is read: a finished run leaves Unread once its conversation is the open one. Only an
    // Unread one: the inbox's read also sends a waiting conversation back to idle.
    const readId = activeId === GENERAL_PAGE_ID ? generalId : activeId
    const activeUnseen = !!readId && conversations.some(conversation => conversation.id === readId && stateOf(conversation) === 'new')
    useEffect(() => {
        if (!activeUnseen || !readId || !accessToken || !workspaceId) return
        markInboxRead({ accessToken, workspaceId }, [readId])
            .then(loadConversations)
            .catch(() => {})
    }, [activeUnseen, readId, accessToken, workspaceId, loadConversations])

    const open = (id: string) => {
        if (id !== GENERAL_PAGE_ID && id !== generalId) openChat(id)
        setActiveId(id)
        router.setParams({ id })
    }

    const showDraft = () => {
        setActiveId(null)
        router.setParams({ id: 'new' })
    }

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
            <ConversationPager pages={pages} activeIndex={activeIndex} progress={progress} onSettle={settleOn} renderPage={(page: ConversationPage, onScreen) => <ConversationPane coworker={coworker} makeEndpoints={() => coworkerEndpoints(agentId, { general: page.general })} initialSessionId={page.sessionId} onSessionCreated={page.general ? onGeneralCreated : onSessionCreated} models={models} status={(page.sessionId && byId.get(page.sessionId)?.status) || null} onStatusChange={loadConversations} webUrl={`${environment.apiUrl}/?agent=${encodeURIComponent(agentId)}`} onScreen={onScreen} startedBy={startedByOf(page.sessionId ? byId.get(page.sessionId) : undefined)} threads={page.general ? generalThreads : undefined} onOpenThread={select} />} />
            <ChatHeader coworker={coworker} tabs={tabs} activeId={shownId ?? undefined} progress={progress} allSessions={allTabs} onBack={back} onSelect={select} onNewSession={startNew} onOpenDetails={() => router.push({ pathname: '/coworker/[id]', params: { id: agentId, name: coworker.name } })} />
        </View>
    )
}
