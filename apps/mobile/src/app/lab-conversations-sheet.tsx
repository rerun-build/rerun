import { router, useLocalSearchParams } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { stateOf, WAITING_GLYPH, type ConversationState } from '@/components/chat/conversation-sections'
import { SectionHeader } from '@/components/home/SectionHeader'
import { AppText } from '@/components/ui/AppText'
import { Chip } from '@/components/ui/Chip'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { GlassButton } from '@/components/ui/GlassButton'
import { UnreadDot } from '@/components/ui/UnreadDot'
import { LAB_CONVERSATIONS, type LabConversation } from '@/mocks/conversations'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

// Dev only: the sheet a tap on the chat header's chip could open, to find a conversation by its state.
//   /lab-conversations-sheet?variant=b   b: one list by date, filtered by chips; c: grouped by state,
//   a routine's runs folded under one row

const ACTIVE_ID = 'c1'
const PULSE = { id: 'agent-pulse', kind: 'coworker' as const, name: 'clem cv', status: 'working' as const }

function timeAgo(minutes: number): string {
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
    return `${Math.floor(minutes / (60 * 24))}d`
}

function Leading({ conversation }: { conversation: LabConversation }) {
    const theme = useTheme()
    const state = stateOf(conversation)
    return (
        <View style={{ width: 20, alignItems: 'center', paddingTop: 3 }}>
            {state === 'needs-you' && <SymbolView name={WAITING_GLYPH[conversation.status] ?? 'circle.fill'} size={15} tintColor={conversation.status === 'error' ? theme.destructive : theme.waiting} />}
            {state === 'running' && <ActivityIndicator size="small" color={theme.mutedForeground} style={{ transform: [{ scale: 0.8 }] }} />}
            {state === 'new' && <UnreadDot style={{ marginTop: 4 }} />}
        </View>
    )
}

function detailOf(conversation: LabConversation): { text: string; tone: 'muted' | 'waiting' | 'destructive' } | null {
    const state = stateOf(conversation)
    const routine = conversation.source === 'schedule' ? 'Routine' : null
    if (state === 'needs-you') return { text: conversation.ask ?? 'Needs you', tone: conversation.status === 'error' ? 'destructive' : 'waiting' }
    if (state === 'running') return { text: [`Working · ${conversation.steps ?? 1} steps`, routine].filter(Boolean).join(' · '), tone: 'muted' }
    if (state === 'new') return { text: ['Done', routine].filter(Boolean).join(' · '), tone: 'muted' }
    return routine ? { text: routine, tone: 'muted' } : null
}

export function ConversationRow({ conversation, active, count, expanded, onPress }: { conversation: LabConversation; active: boolean; count?: number; expanded?: boolean; onPress: () => void }) {
    const theme = useTheme()
    const state = stateOf(conversation)
    const detail = detailOf(conversation)
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, backgroundColor: pressed ? theme.muted : active ? theme.secondary : 'transparent', borderRadius: radius.md, marginHorizontal: spacing.sm })}>
            <Leading conversation={conversation} />
            <View style={{ flex: 1, gap: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
                    <AppText variant="callout" medium={state !== 'earlier'} numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ flex: 1 }}>
                        {conversation.title}
                        {count !== undefined && count > 1 && <AppText variant="callout" tone="muted">{`  ×${count}`}</AppText>}
                    </AppText>
                    <AppText variant="footnote" tone="muted" maxFontSizeMultiplier={1.4}>
                        {state === 'running' ? 'now' : timeAgo(conversation.minutesAgo)}
                    </AppText>
                    {count !== undefined && count > 1 && <SymbolView name={expanded ? 'chevron.up' : 'chevron.down'} size={11} weight="semibold" tintColor={theme.mutedForeground} />}
                </View>
                {detail && (
                    <AppText variant="footnote" tone={detail.tone} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                        {detail.text}
                    </AppText>
                )}
            </View>
        </Pressable>
    )
}

type Filter = 'all' | 'needs-you' | 'running' | 'new'
const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'needs-you', label: 'Needs you' },
    { key: 'running', label: 'Running' },
    { key: 'new', label: 'Unread' },
]

function ByDate({ conversations, onOpen }: { conversations: LabConversation[]; onOpen: () => void }) {
    const [filter, setFilter] = useState<Filter>('all')
    const countOf = (key: Filter) => (key === 'all' ? conversations.length : conversations.filter(conversation => stateOf(conversation) === key).length)
    const shown = [...conversations].filter(conversation => filter === 'all' || stateOf(conversation) === filter).sort((a, b) => a.minutesAgo - b.minutesAgo)
    return (
        <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
                {FILTERS.filter(entry => entry.key === 'all' || entry.key === filter || countOf(entry.key) > 0).map(entry => (
                    <Chip key={entry.key} label={entry.key === 'all' ? entry.label : `${entry.label} ${countOf(entry.key)}`} selected={filter === entry.key} onPress={() => setFilter(entry.key)} />
                ))}
            </ScrollView>
            {shown.map(conversation => (
                <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === ACTIVE_ID} onPress={onOpen} />
            ))}
        </>
    )
}

const SECTIONS: { state: ConversationState; label: string }[] = [
    { state: 'needs-you', label: 'Needs you' },
    { state: 'running', label: 'Running' },
    { state: 'new', label: 'Unread' },
    { state: 'earlier', label: 'Earlier' },
]

// A routine leaves one conversation per run: the runs already read fold under their newest one.
function foldRoutines(conversations: LabConversation[]): { head: LabConversation; runs: LabConversation[] }[] {
    const groups: { head: LabConversation; runs: LabConversation[] }[] = []
    for (const conversation of [...conversations].sort((a, b) => a.minutesAgo - b.minutesAgo)) {
        const group = conversation.source === 'schedule' ? groups.find(candidate => candidate.head.source === 'schedule' && candidate.head.title === conversation.title) : undefined
        if (group) group.runs.push(conversation)
        else groups.push({ head: conversation, runs: [conversation] })
    }
    return groups
}

function ByState({ conversations, onOpen }: { conversations: LabConversation[]; onOpen: () => void }) {
    const [collapsed, setCollapsed] = useState<ConversationState[]>([])
    const [unfolded, setUnfolded] = useState<string[]>([])
    const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter(entry => entry !== value) : [...list, value])
    const sections = SECTIONS.map(section => ({ ...section, conversations: conversations.filter(conversation => stateOf(conversation) === section.state) })).filter(section => section.conversations.length > 0)
    return (
        <>
            {sections.map((section, index) => {
                const groups = section.state === 'earlier' ? foldRoutines(section.conversations) : section.conversations.map(conversation => ({ head: conversation, runs: [conversation] }))
                return (
                    <View key={section.state} style={{ paddingBottom: spacing.xs }}>
                        <SectionHeader label={section.label} count={section.conversations.length} collapsed={collapsed.includes(section.state)} onToggle={() => setCollapsed(toggle(collapsed, section.state))} divided={index > 0} />
                        {!collapsed.includes(section.state) &&
                            groups.map(({ head, runs }) => {
                                const isUnfolded = unfolded.includes(head.id)
                                return (
                                    <View key={head.id}>
                                        <ConversationRow conversation={head} active={head.id === ACTIVE_ID} count={runs.length} expanded={isUnfolded} onPress={runs.length > 1 ? () => setUnfolded(toggle(unfolded, head.id)) : onOpen} />
                                        {isUnfolded &&
                                            runs.map(run => (
                                                <View key={run.id} style={{ paddingLeft: spacing.xl }}>
                                                    <ConversationRow conversation={{ ...run, source: 'dashboard', title: `Run of ${timeAgo(run.minutesAgo)} ago` }} active={run.id === ACTIVE_ID} onPress={onOpen} />
                                                </View>
                                            ))}
                                    </View>
                                )
                            })}
                    </View>
                )
            })}
        </>
    )
}

export default function ConversationsSheetLab() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const params = useLocalSearchParams<{ variant?: string }>()
    const [query, setQuery] = useState('')
    const found = LAB_CONVERSATIONS.filter(conversation => conversation.title.toLowerCase().includes(query.trim().toLowerCase()))
    const close = () => router.back()

    // A form sheet lays out its scroll view itself: the header lives inside it, or the list covers it.
    return (
        <ScrollView style={{ backgroundColor: theme.background }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingTop: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}>
            <View collapsable={false} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
                <GlassButton symbol="xmark" label="Close" onPress={close} />
                <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Coworker details" style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                    <CoworkerAvatar coworker={PULSE} size={22} facing="right" animated={false} />
                    <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.2}>
                        {PULSE.name}
                    </AppText>
                    <SymbolView name="chevron.right" size={12} weight="semibold" tintColor={theme.mutedForeground} />
                </Pressable>
                <GlassButton symbol="square.and.pencil" label="New conversation" onPress={close} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 40, marginHorizontal: spacing.lg, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: theme.muted }}>
                <SymbolView name="magnifyingglass" size={15} tintColor={theme.mutedForeground} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search conversations" placeholderTextColor={theme.mutedForeground} autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing" style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: theme.foreground }} />
            </View>

            {found.length === 0 ? (
                <AppText variant="callout" tone="muted" style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
                    No conversation by that name.
                </AppText>
            ) : params.variant === 'c' ? (
                <ByState conversations={found} onOpen={close} />
            ) : (
                <ByDate conversations={found} onOpen={close} />
            )}
        </ScrollView>
    )
}
