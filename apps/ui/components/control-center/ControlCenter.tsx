'use client'

import { useAgentTabs } from '@/components/agent/agent-tabs'
import { useBoxViewer, useManageableSpaceIds } from '@/hooks/useBoxAccess'
import { useIsTemplateAuthor } from '@/hooks/useIsTemplateAuthor'
import { useModKeyLabel } from '@/hooks/useModKeyLabel'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { isApiLocked, isWorkspaceApiEntitled } from '@rerun/cloud/billing'
import { ATTENTION_STATUSES } from '@/lib/board/attention'
import type { AgentStatus, IsoAgent } from '@/lib/board/types'
import { buildControlCommands, type ControlCommand, type ControlCommandId } from '@/lib/control-center/commands'
import { useSupport } from '@/components/brand/useSupport'
import { parseQuery, searchItems } from '@/lib/control-center/search'
import { MACHINE_SOURCES, SEARCH_FILTERS, splitPath, stillSearching, type SearchFilter, type SearchSource } from '@/lib/control-center/global-search'
import { BellIcon, BoxIcon, BrainIcon, CirclePlusIcon, CreditCardIcon, FileTextIcon, FocusCenterIcon, FolderIcon, GridIcon, HeadsetIcon, KeyboardIcon, KeyIcon, LayersIcon, LockKeyholeIcon, MegaphoneIcon, MessageCircle, MessageCircleQuestionIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon, TableIcon, UserRoundIcon, UsersIcon } from '@/lib/icons'
import { useAccountStore } from '@/stores/account.store'
import { useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useBuilderDialogsStore } from '@/stores/builder-dialogs.store'
import { selectHasEntries, useChangelogStore } from '@/stores/changelog.store'
import { useControlCenterStore } from '@/stores/control-center.store'
import { useDesktopStore } from '@/stores/desktop.store'
import { selectForemanOpen, selectForemanVisible, useForemanStore } from '@/stores/foreman.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useShortcutsStore } from '@/stores/shortcuts.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useIsWorkspaceAdmin, useSession } from '@/supabase/session/SessionProvider'
import { useForemanName } from '@/hooks/useForemanName'
import type { BadgeTone } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { useEffect, useState, type ComponentType } from 'react'

import { ControlCenterView } from './ControlCenterView'
import type { ControlRow, ControlSection, SourceChip } from './types'
import { useConversationSearch } from './useConversationSearch'
import { useWorkspaceSearch } from './useWorkspaceSearch'
import { FOREMAN_AGENT_ID, type WorkspaceSearchHit } from '@rerun/contracts'
import { shortRelativeTime } from '@rerun/ui/time'
import { openForemanConversation } from '@/lib/notifications/open-inbox-item'

type Page = { kind: 'root' } | { kind: 'agent'; agentId: string } | { kind: 'box'; spaceId: string } | { kind: 'move'; agentId: string }

const ROOT: Page = { kind: 'root' }

const AGENT_RESULTS = 8
const BOX_RESULTS = 5
const MIN_CONVERSATION_QUERY = 2

type HitRow = ControlRow & { source: SearchSource }

// What a hit of the machine says, so an answer to an earlier query can stay on screen while it still fits.
function hitMentions(hit: WorkspaceSearchHit, text: string): boolean {
    const shown = [hit.snippet, 'title' in hit ? hit.title : '', 'name' in hit ? hit.name : '', 'path' in hit ? hit.path : '']
    return shown.some(part => part.toLowerCase().includes(text))
}

const COMMAND_ICONS: Record<ControlCommandId, ComponentType<{ className?: string }>> = {
    new_agent: CirclePlusIcon,
    browse_templates: GridIcon,
    new_box: BoxIcon,
    ask_assistant: MessageCircleQuestionIcon,
    contact_support: HeadsetIcon,
    recenter_board: FocusCenterIcon,
    toggle_theme: SunIcon,
    workspace: SettingsIcon,
    members: UsersIcon,
    billing: CreditCardIcon,
    ai_providers: LockKeyholeIcon,
    api_keys: KeyIcon,
    company_brain: BrainIcon,
    shared_files: FolderIcon,
    account: UserRoundIcon,
    notifications: BellIcon,
    shortcuts: KeyboardIcon,
    whats_new: MegaphoneIcon,
}

const STATUS_BADGE_TONES = { waiting_human: 'orange', working: 'cyan', error: 'red', offline: 'neutral' } as const satisfies Partial<Record<AgentStatus, BadgeTone>>

type BadgedStatus = keyof typeof STATUS_BADGE_TONES

function isBadgedStatus(status: AgentStatus): status is BadgedStatus {
    return status in STATUS_BADGE_TONES
}

function pageKey(page: Page): string {
    if (page.kind === 'root') return 'root'
    return page.kind === 'box' ? `box:${page.spaceId}` : `${page.kind}:${page.agentId}`
}

function isMacPlatform(): boolean {
    return /Mac|iPhone|iPad/i.test(navigator.userAgent)
}

export function ControlCenter() {
    const t = useTranslations('layout.controlCenter')
    const locale = useLocale()
    const foremanName = useForemanName()
    const foremanLabel = useTranslations('workspaceView.foreman')('name', foremanName)
    const tReasons = useTranslations('workspace.access')
    const agentTabs = useAgentTabs()
    const open = useControlCenterStore(s => s.open)
    const setOpen = useControlCenterStore(s => s.setOpen)
    const recentAgentIds = useControlCenterStore(s => s.recentAgentIds)
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)
    const boxViewer = useBoxViewer()
    const manageableSpaceIds = useManageableSpaceIds()
    const hydrated = useBoardStore(s => s.hydrated)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const sessions = useBoardStore(s => s.sessions)
    const { workspace } = useSession()
    const support = useSupport()
    const workspaceAdmin = useIsWorkspaceAdmin()
    const { needsMachineReason, manager } = useWorkspaceAccess()
    const isTemplateAuthor = useIsTemplateAuthor()
    const assistantReady = useForemanStore(s => selectForemanVisible(s) && s.funnel === 'companion')
    const assistantOpen = useForemanStore(selectForemanOpen)
    const hasChangelog = useChangelogStore(selectHasEntries)
    const { resolvedTheme, setTheme } = useTheme()
    const mod = useModKeyLabel()
    const [pages, setPages] = useState<Page[]>([ROOT])
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<SearchFilter>('all')
    const [wasOpen, setWasOpen] = useState(open)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (open) {
            setPages([ROOT])
            setQuery('')
            setFilter('all')
        }
    }

    const available = !!workspace && hydrated
    const page = pages[pages.length - 1]
    const { scope, text } = parseQuery(query)
    const pageAgent = page.kind === 'agent' || page.kind === 'move' ? agents.find(agent => agent.id === page.agentId) : undefined
    const pageSpace = page.kind === 'box' ? spaces.find(space => space.id === page.spaceId) : undefined
    const darkTheme = resolvedTheme === 'dark'

    // From two characters typed on the root, the search reaches into everything the workspace holds.
    const searchingEverything = open && page.kind === 'root' && scope === 'all' && text.length >= MIN_CONVERSATION_QUERY
    const searchesConversations = searchingEverything || (open && page.kind === 'agent')
    const conversations = useConversationSearch(text, page.kind === 'agent' ? page.agentId : null, searchesConversations)
    const machine = useWorkspaceSearch(text, searchingEverything)
    const shownFilter = searchingEverything ? filter : 'all'

    // ⌘F on a Mac, Ctrl+F elsewhere: Ctrl+F on a Mac moves the caret in a text field. Pressed while
    // the center is open it only closes it, and the browser goes on to open its own search.
    // ⌘K goes to the assistant's composer, the pill of the parked one or the column's, except where
    // it already means something: an open agent panel (new conversation) and the Brain (its search).
    // Without an assistant to write to (a phone, the onboarding) it toggles the center as ⌘F does.
    // The chats of closed panels stay mounted and listen for ⌘K on the document, hence the
    // stopPropagation.
    useEffect(() => {
        if (!available) return
        const onKey = (event: KeyboardEvent) => {
            // Chrome autofill fires keydown events without a key.
            const key = event.key?.toLowerCase()
            if ((key !== 'f' && key !== 'k') || event.shiftKey || event.altKey) return
            const mac = isMacPlatform()
            if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return
            const center = useControlCenterStore.getState()
            if (key === 'k') {
                if (!center.open && (useBoardStore.getState().selectedAgentId || document.querySelector('[data-brain-workspace]'))) return
                event.preventDefault()
                event.stopPropagation()
                const foreman = useForemanStore.getState()
                if (foreman.pillAvailable || (selectForemanOpen(foreman) && foreman.funnel === 'companion')) {
                    if (center.open) center.setOpen(false)
                    foreman.requestComposerFocus()
                    return
                }
                center.setOpen(!center.open)
                return
            }
            if (center.open) {
                center.setOpen(false)
                return
            }
            event.preventDefault()
            center.setOpen(true)
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [available])

    useEffect(() => {
        if (selectedAgentId) useControlCenterStore.getState().rememberAgent(selectedAgentId)
    }, [selectedAgentId])

    if (!available) return null

    const unnamedBox = t('unnamedBox')
    const boxName = (spaceId: string) => spaces.find(space => space.id === spaceId)?.name || unnamedBox

    const run = (action: () => void) => () => {
        setOpen(false)
        action()
    }

    const drill = (next: Page) => () => {
        setPages(stack => [...stack, next])
        setQuery('')
    }

    const back = () => {
        setPages(stack => (stack.length > 1 ? stack.slice(0, -1) : stack))
        setQuery('')
    }

    const agentRow = (agent: IsoAgent, section: string): ControlRow => ({
        id: `${section}-agent-${agent.id}`,
        label: agent.name,
        detail: boxName(agent.spaceId),
        leading: { kind: 'agent', agentId: agent.id },
        badge: agent.disabledAt ? { label: t('status.off'), tone: 'neutral' } : isBadgedStatus(agent.status) ? { label: t(`status.${agent.status}`), tone: STATUS_BADGE_TONES[agent.status] } : undefined,
        onSelect: run(() => useBoardStore.getState().focusAgentOnBoard(agent.id, 'chat')),
        onDrill: drill({ kind: 'agent', agentId: agent.id }),
    })

    const conversationRows = (section: string, withAgentName: boolean): ControlRow[] =>
        conversations.hits.map(hit => ({
            id: `${section}-conversation-${hit.id}`,
            label: hit.title,
            detail: withAgentName ? (hit.agentId === FOREMAN_AGENT_ID ? foremanLabel : agents.find(agent => agent.id === hit.agentId)?.name) : undefined,
            leading: { kind: 'icon', icon: MessageCircle },
            onSelect: run(() => {
                if (hit.agentId === FOREMAN_AGENT_ID) return openForemanConversation(hit.id)
                const board = useBoardStore.getState()
                board.focusAgentOnBoard(hit.agentId, 'chat')
                board.setPendingOpenSession({ agentId: hit.agentId, sessionId: hit.id, runId: null, title: hit.title })
            }),
        }))

    const conversationSection = (section: string, heading: string, withAgentName: boolean): ControlSection[] => {
        const rows = conversationRows(section, withAgentName)
        const loading = conversations.loading && rows.length === 0
        return rows.length > 0 || loading ? [{ id: section, heading, rows, loading }] : []
    }

    const commandActions: Record<ControlCommandId, () => void> = {
        new_agent: () => useBuilderDialogsStore.getState().openNewAgent(),
        browse_templates: () => useBuilderDialogsStore.getState().openLibrary(),
        new_box: () => useBuilderDialogsStore.getState().setNewBoxOpen(true),
        ask_assistant: () => (text ? useForemanStore.getState().askForeman(query.trim()) : useForemanStore.getState().toggle()),
        contact_support: () => support.open(),
        recenter_board: () => useBoardStore.getState().recenterBoard(),
        toggle_theme: () => setTheme(darkTheme ? 'light' : 'dark'),
        workspace: () => useWorkspaceSettingsStore.getState().openWorkspacePanel('workspace'),
        members: () => useWorkspaceSettingsStore.getState().openWorkspacePanel('members'),
        billing: () => useBillingStore.getState().openBilling(undefined, 'control_center'),
        ai_providers: () => useWorkspaceSettingsStore.getState().openWorkspacePanel('ai_providers'),
        api_keys: () => useWorkspaceSettingsStore.getState().openWorkspacePanel('api_keys'),
        company_brain: () => useWorkspaceSettingsStore.getState().openWorkspacePanel('knowledge_base'),
        shared_files: () => useWorkspaceSettingsStore.getState().openKnowledgeBase('files'),
        account: () => useAccountStore.getState().openAccount(),
        notifications: () => useNotificationsStore.getState().openNotifications(),
        shortcuts: () => useShortcutsStore.getState().openShortcuts(),
        whats_new: () => useChangelogStore.getState().openAll(),
    }

    const commandRow = (command: ControlCommand): ControlRow => ({
        id: `command-${command.id}`,
        label: command.label,
        leading: { kind: 'icon', icon: command.id === 'toggle_theme' && !darkTheme ? MoonIcon : COMMAND_ICONS[command.id] },
        badge: command.paid ? { label: t('pro'), tone: 'brand' } : undefined,
        disabledReason: command.disabledReason,
        onSelect: run(command.paid ? () => useBillingStore.getState().openBilling(undefined, command.id) : commandActions[command.id]),
    })

    // Every hit of the global search, in the order of the chips, with `detail` saying where it sits.
    function globalHits(): { rows: HitRow[]; counts: Map<SearchSource, number>; machineLoading: boolean } {
        const agentById = new Map(agents.map(agent => [agent.id, agent]))
        const ownerOf = (agentId: string | null) => (agentId ? agentById.get(agentId)?.name : t('hit.shared'))
        const fresh = machine.hits.filter(hit => !machine.loading || hitMentions(hit, text))
        const matched = searchItems(
            agents.map(agent => ({ agent, label: agent.name, keywords: [agent.handle ?? '', agent.description ?? ''] })),
            text,
            AGENT_RESULTS
        )
        // A soul usually names its coworker: typing the name opens the coworker, never its soul.
        const matchedIds = new Set(matched.map(({ agent }) => agent.id))
        const soulHits = fresh.filter(hit => hit.kind === 'coworker').filter(hit => !matchedIds.has(hit.agentId))

        const coworkers: HitRow[] = [
            ...matched.map(({ agent }): HitRow => ({ ...agentRow(agent, 'hits'), badge: undefined, source: 'coworker', snippet: agent.description ?? undefined })),
            ...soulHits.flatMap((hit): HitRow[] => {
                const agent = agentById.get(hit.agentId)
                if (!agent) return []
                return [{ id: `hits-soul-${agent.id}`, label: agent.name, detail: t('hit.soul', { box: boxName(agent.spaceId) }), leading: { kind: 'agent', agentId: agent.id }, source: 'coworker', snippet: hit.snippet, onSelect: run(() => useBoardStore.getState().focusAgentOnBoard(agent.id, 'settings')) }]
            }),
        ]

        const machineRows = fresh.flatMap((hit, index): HitRow[] => {
            const id = `hits-${hit.kind}-${index}`
            if (hit.kind === 'coworker') return []
            if (hit.kind === 'brain') return [{ id, label: hit.title, leading: { kind: 'icon', icon: BrainIcon }, source: 'brain', snippet: hit.snippet, onSelect: run(() => useWorkspaceSettingsStore.getState().openBrainPage(hit.slug)) }]
            const owner = ownerOf(hit.agentId)
            if (owner === undefined) return []
            const agentId = hit.agentId
            if (hit.kind === 'skill') {
                return [{ id, label: hit.name, detail: agentId ? t('hit.skill', { owner }) : t('hit.brainSkill'), leading: { kind: 'icon', icon: LayersIcon }, source: 'skill', snippet: hit.snippet, onSelect: run(() => (agentId ? useBoardStore.getState().openAgentSkill(agentId, hit.slug) : useWorkspaceSettingsStore.getState().openBrainSkill(hit.slug))) }]
            }
            if (hit.kind === 'file') {
                const { name, folder } = splitPath(hit.path)
                const detail = t('hit.file', { owner, hasFolder: folder ? 'yes' : 'no', folder, hasLine: hit.line === null ? 'no' : 'yes', line: hit.line ?? 0 })
                return [{ id, label: name, detail, leading: { kind: 'icon', icon: FileTextIcon }, source: 'file', snippet: hit.line === null ? undefined : hit.snippet, onSelect: run(() => (agentId ? useBoardStore.getState().openAgentFile(agentId, hit.path) : useWorkspaceSettingsStore.getState().openBrainFile(hit.path))) }]
            }
            const detail = t('hit.table', { hasOwner: agentId ? 'yes' : 'no', owner, table: hit.table, hasRow: hit.rowId === null ? 'no' : 'yes', row: hit.rowId ?? 0 })
            return [{ id, label: hit.title || hit.table, detail, leading: { kind: 'icon', icon: TableIcon }, source: 'table', snippet: hit.snippet, onSelect: run(() => (agentId ? useBoardStore.getState().openAgentData(agentId, hit.table) : useWorkspaceSettingsStore.getState().openKnowledgeBase('database', hit.table))) }]
        })

        const conversationHits = conversationRows('hits', false).map((row, index): HitRow => {
            const hit = conversations.hits[index]
            const agentName = hit.agentId === FOREMAN_AGENT_ID ? foremanLabel : (agentById.get(hit.agentId)?.name ?? '')
            return { ...row, detail: t('hit.conversation', { agent: agentName, when: shortRelativeTime(hit.updatedAt, locale) }), source: 'conversation' }
        })

        const rows = [...coworkers, ...machineRows, ...conversationHits].sort((a, b) => SEARCH_FILTERS.indexOf(a.source) - SEARCH_FILTERS.indexOf(b.source))
        const counts = new Map<SearchSource, number>()
        for (const row of rows) counts.set(row.source, (counts.get(row.source) ?? 0) + 1)
        return { rows, counts, machineLoading: machine.loading }
    }

    function sourceChips(): SourceChip[] {
        const { counts, machineLoading } = globalHits()
        // The coworkers' names are known at once, their souls come with the machine.
        const pending = (source: SearchSource) => (machineLoading && (MACHINE_SOURCES.has(source) || (source === 'coworker' && !counts.get(source)))) || (source === 'conversation' && conversations.loading)
        const sources = SEARCH_FILTERS.filter((value): value is SearchSource => value !== 'all')
        const anyPending = sources.some(pending)
        const found = [...counts.values()].reduce((sum, count) => sum + count, 0)
        // Nothing found where nothing could be searched is not a zero.
        const shownCount = (count: number, readsMachine: boolean): SourceChip['count'] => (count === 0 && readsMachine && machine.unavailable ? 'unknown' : count)
        return [
            { value: 'all', label: t('sources.all'), count: anyPending ? 'pending' : shownCount(found, true) },
            ...sources.map(source => ({ value: source, label: t(`sources.${source}`), count: pending(source) ? ('pending' as const) : shownCount(counts.get(source) ?? 0, source !== 'conversation') })),
        ]
    }

    function rootSections(): ControlSection[] {
        const commands = buildControlCommands({ isSandbox: workspace?.is_sandbox ?? false, managed: manager !== null, apiPausedReason: manager && workspace && !isWorkspaceApiEntitled(workspace) ? needsMachineReason : null, workspaceAdmin, apiEntitled: workspace ? isWorkspaceApiEntitled(workspace) : false, apiLocked: workspace ? isApiLocked(workspace) : false, needsMachineReason, assistantReady, hasChangelog, darkTheme, supportAvailable: support.available }, { sandbox: tReasons('sandboxNone'), admin: tReasons('adminsOnly'), singleBox: tReasons('sandboxSingleBox'), apiLocked: tReasons('apiNotIncluded') }).map(command => ({
            ...command,
            label: command.id === 'toggle_theme' ? t(darkTheme ? 'commands.toggle_theme_light' : 'commands.toggle_theme_dark') : t(`commands.${command.id}`, foremanName),
        }))
        // "Ask the assistant" with a query is the last row of the list, not an action among others.
        const listed = text ? commands.filter(command => command.id !== 'ask_assistant') : commands
        const commandSections: ControlSection[] = [
            { id: 'actions', heading: t('headings.actions'), rows: searchItems(listed.filter(command => command.group === 'actions'), text).map(commandRow) },
            { id: 'settings', heading: t('headings.settings'), rows: searchItems(listed.filter(command => command.group === 'settings'), text).map(commandRow) },
        ]
        const searchableAgents = agents.map(agent => ({ agent, label: agent.name, keywords: [agent.handle ?? '', boxName(agent.spaceId)] }))

        if (scope === 'commands') return commandSections
        if (scope === 'agents') return [{ id: 'agents', heading: t('headings.agents'), rows: searchItems(searchableAgents, text).map(entry => agentRow(entry.agent, 'agents')) }]

        if (!text) {
            const waiting = agents.filter(agent => agent.status === 'waiting_human' && !agent.disabledAt)
            const waitingIds = new Set(waiting.map(agent => agent.id))
            const recent = recentAgentIds.map(id => agents.find(agent => agent.id === id)).filter((agent): agent is IsoAgent => !!agent && !waitingIds.has(agent.id))
            const others = agents.filter(agent => !waitingIds.has(agent.id)).slice(0, AGENT_RESULTS)
            return [
                { id: 'needs-you', heading: t('headings.needsYou'), rows: waiting.map(agent => agentRow(agent, 'needs-you')) },
                recent.length > 0 ? { id: 'recent', heading: t('headings.recent'), rows: recent.map(agent => agentRow(agent, 'recent')) } : { id: 'agents', heading: t('headings.agents'), rows: others.map(agent => agentRow(agent, 'agents')) },
                ...commandSections,
            ]
        }

        const boxes = searchItems(
            spaces.map(space => ({ space, label: space.name || unnamedBox })),
            text,
            BOX_RESULTS
        ).map(({ space, label }): ControlRow => {
            const count = agents.filter(agent => agent.spaceId === space.id).length
            const enter = drill({ kind: 'box', spaceId: space.id })
            return { id: `box-${space.id}`, label, detail: t('boxAgents', { count }), leading: { kind: 'icon', icon: BoxIcon }, onSelect: enter, onDrill: enter }
        })

        const askAssistant: ControlSection[] = assistantReady
            ? [{ id: 'assistant', heading: t('headings.assistant', foremanName), rows: [{ id: 'ask-assistant', label: t('askRerun', foremanName), detail: t('quotedQuery', { query: query.trim() }), leading: { kind: 'assistant' }, onSelect: run(commandActions.ask_assistant) }] }]
            : []

        if (searchingEverything) {
            const hits = globalHits()
            const shown = shownFilter === 'all' ? hits.rows : hits.rows.filter(row => row.source === shownFilter)
            const notice = machine.unavailable ? t('notice.unavailable') : machine.truncated ? t('notice.partial') : undefined
            const hitSection: ControlSection = {
                id: 'hits',
                heading: shownFilter === 'all' ? t('headings.bestMatches') : t(`sources.${shownFilter}`),
                rows: shownFilter === 'all' ? shown.map(row => ({ ...row, detail: row.detail ? t('hit.sourceWhere', { source: t(`sources.${row.source}`), where: row.detail }) : t(`sources.${row.source}`) })) : shown,
                loading: stillSearching(shownFilter, new Set(shown.map(row => row.source)), { machine: hits.machineLoading, conversations: conversations.loading }),
                notice: shownFilter === 'conversation' ? undefined : notice,
                emptyMessage: t('empty.nothingMentions', { query: query.trim() }),
            }
            if (shownFilter !== 'all') return [hitSection]
            return [...commandSections, { id: 'boxes', heading: t('headings.boxes'), rows: boxes }, hitSection, ...askAssistant]
        }

        return [
            { id: 'agents', heading: t('headings.agents'), rows: searchItems(searchableAgents, text, AGENT_RESULTS).map(entry => agentRow(entry.agent, 'agents')) },
            { id: 'boxes', heading: t('headings.boxes'), rows: boxes },
            ...commandSections,
            ...conversationSection('conversations', t('headings.conversations'), true),
            ...askAssistant,
        ]
    }

    function agentSections(agent: IsoAgent): ControlSection[] {
        const board = useBoardStore.getState()
        // Same gate as the panel's rail: the agent's own status ranks `working` above what waits on a human.
        const hasToHandle = sessions.some(session => session.agentId === agent.id && ATTENTION_STATUSES.has(session.status))
        const tabs = agentTabs.filter(tab => (tab.id !== 'actions' || hasToHandle) && (tab.id !== 'setup' || isTemplateAuthor))
        const tabRows = searchItems(tabs, text).map((tab): ControlRow => ({ id: `tab-${tab.id}`, label: tab.label, detail: tab.description, leading: { kind: 'icon', icon: tab.icon }, onSelect: run(() => board.focusAgentOnBoard(agent.id, tab.id)) }))

        const actions: (ControlRow & { keywords?: string[] })[] = []
        actions.push({
            id: 'agent-desktop',
            label: t('agent.desktop'),
            detail: t('agent.desktopDetail'),
            keywords: ['screen', 'browser', 'computer'],
            leading: { kind: 'icon', icon: MonitorIcon },
            disabledReason: needsMachineReason,
            onSelect: run(() => {
                board.focusAgentOnBoard(agent.id)
                useDesktopStore.getState().openDesktop(agent.id)
            }),
        })
        if (spaces.length > 1) {
            const enter = drill({ kind: 'move', agentId: agent.id })
            actions.push({ id: 'agent-move', label: t('agent.move'), detail: boxName(agent.spaceId), keywords: ['box', 'team'], leading: { kind: 'icon', icon: BoxIcon }, onSelect: enter, onDrill: enter })
        }
        actions.push({ id: 'agent-notifications', label: t('agent.notifications'), detail: t('agent.notificationsDetail'), keywords: ['alerts'], leading: { kind: 'icon', icon: BellIcon }, onSelect: run(() => useNotificationsStore.getState().openNotifications(agent.id)) })

        return [{ id: 'tabs', heading: t('headings.open'), rows: tabRows }, { id: 'agent-actions', heading: t('headings.actions'), rows: searchItems(actions, text) }, ...conversationSection('agent-conversations', text ? t('headings.conversations') : t('headings.recentConversations'), false)]
    }

    function sections(): ControlSection[] {
        if (page.kind === 'root') return rootSections()
        if (page.kind === 'box') {
            const inBox = agents.filter(agent => agent.spaceId === page.spaceId).map(agent => ({ agent, label: agent.name, keywords: [agent.handle ?? ''] }))
            return [{ id: 'box-agents', heading: t('headings.agents'), rows: searchItems(inBox, text).map(entry => agentRow(entry.agent, 'box')) }]
        }
        if (!pageAgent) return []
        if (page.kind === 'agent') return agentSections(pageAgent)
        const destinations = spaces.filter(space => space.id !== pageAgent.spaceId && manageableSpaceIds.has(space.id)).map(space => ({ space, label: space.name || unnamedBox }))
        return [
            {
                id: 'move',
                heading: t('headings.moveTo'),
                rows: searchItems(destinations, text).map(({ space, label }) => ({ id: `move-${space.id}`, label, leading: { kind: 'icon', icon: BoxIcon }, onSelect: run(() => useBoardStore.getState().moveAgentToBox(pageAgent.id, space.id, boxViewer)) })),
            },
        ]
    }

    const crumbs = page.kind === 'root' ? [] : page.kind === 'box' ? [pageSpace?.name || unnamedBox] : page.kind === 'move' ? [pageAgent?.name ?? '', t('agent.move')] : [pageAgent?.name ?? '']
    const placeholder =
        page.kind === 'root'
            ? assistantReady
                ? t('placeholder.rootAssistant', foremanName)
                : t('placeholder.root')
            : page.kind === 'agent'
              ? pageAgent
                  ? t('placeholder.agent', { name: pageAgent.name })
                  : t('placeholder.agentUnknown')
              : page.kind === 'box'
                ? t('placeholder.box')
                : t('placeholder.move')
    const emptyLabel = page.kind === 'box' && !text ? t('empty.box') : t('empty.noMatch')

    return (
        <ControlCenterView
            open={open}
            onOpenChange={setOpen}
            anchorToOrb={assistantReady && !assistantOpen}
            query={query}
            onQueryChange={setQuery}
            placeholder={placeholder}
            pageKey={pageKey(page)}
            depth={pages.length - 1}
            crumbs={crumbs}
            onBack={back}
            sections={sections().filter(section => section.rows.length > 0 || section.loading || section.emptyMessage)}
            emptyLabel={emptyLabel}
            mod={mod}
            chips={searchingEverything ? sourceChips() : undefined}
            filter={shownFilter}
            onFilterChange={setFilter}
            onAsk={searchingEverything && assistantReady ? run(commandActions.ask_assistant) : undefined}
        />
    )
}
