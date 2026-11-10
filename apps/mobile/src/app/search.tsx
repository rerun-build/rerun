import { parseQuery, searchItems, type Box, type ConversationHit } from '@rerun/contracts'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { fetchBoard } from '@/api/board'
import { searchConversations } from '@/api/search'
import { useAuth } from '@/auth/AuthProvider'
import { setPendingAsk } from '@/chat/pending-ask'
import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { lineOf, minutesSince, moodStatus, toHomeCoworkers, type HomeCoworker } from '@/components/home/board'
import { CoworkerRow } from '@/components/home/CoworkerRow'
import { SectionHeader } from '@/components/home/SectionHeader'
import { AppText } from '@/components/ui/AppText'
import { GlassButton } from '@/components/ui/GlassButton'
import { cachedBoard } from '@/data/local-cache'
import { useTimeAgo } from '@/lib/time'
import { fonts, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/theme'

// The web's control center, minus its commands: coworkers by name, conversations by title. Same rules
// as the web: a leading `@` keeps to coworkers, conversations are looked up from two letters on.
const MIN_CONVERSATION_QUERY = 2
const DEBOUNCE_MS = 250

function useConversationHits(text: string, enabled: boolean): ConversationHit[] {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [answer, setAnswer] = useState<{ text: string; hits: ConversationHit[] } | null>(null)

    useEffect(() => {
        if (!enabled || !accessToken || workspaceId === undefined) return
        let stale = false
        const timer = setTimeout(() => {
            searchConversations({ accessToken, workspaceId }, text)
                .then(hits => !stale && setAnswer({ text, hits }))
                .catch(() => !stale && setAnswer({ text, hits: [] }))
        }, DEBOUNCE_MS)
        return () => {
            stale = true
            clearTimeout(timer)
        }
    }, [text, enabled, accessToken, workspaceId])

    return enabled ? (answer?.hits ?? []) : []
}

function ConversationRow({ hit, coworker, onPress }: { hit: ConversationHit; coworker: HomeCoworker | undefined; onPress: () => void }) {
    const theme = useTheme()
    const timeAgo = useTimeAgo()
    const t = useTranslations('mobileHome')
    const minutes = minutesSince(hit.updatedAt)
    const ago = minutes !== null ? timeAgo(minutes) : null
    const detail = coworker?.name && ago ? t('search.hitDetail', { coworker: coworker.name, time: ago }) : (coworker?.name ?? ago)
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2, backgroundColor: pressed ? theme.muted : 'transparent' })}>
            <AgentBuddy agentId={hit.agentId} size={28} mood="idle" animated={false} facing="right" />
            <View style={{ flex: 1, gap: 1 }}>
                <AppText variant="callout" medium numberOfLines={1}>
                    {hit.title || t('search.newConversation')}
                </AppText>
                <AppText variant="footnote" tone="muted" numberOfLines={1}>
                    {detail}
                </AppText>
            </View>
        </Pressable>
    )
}

type Team = { coworkers: HomeCoworker[]; boxes: Box[] }

// The coworkers and Boxes the Home kept, read again once without the Home's Realtime channel: the
// Home stays mounted under this screen and already holds that channel's name.
function useTeam(): Team | null {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [team, setTeam] = useState<Team | null>(() => {
        const kept = workspaceId === undefined ? null : cachedBoard(workspaceId).read()
        return kept ? { coworkers: toHomeCoworkers(kept.agents, kept.overview), boxes: kept.boxes } : null
    })
    useEffect(() => {
        if (!accessToken || workspaceId === undefined) return
        let alive = true
        const caller = { accessToken, workspaceId }
        cachedBoard(workspaceId)
            .load(() => fetchBoard(caller))
            .then(({ agents, overview, boxes }) => alive && setTeam({ coworkers: toHomeCoworkers(agents, overview), boxes }))
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [accessToken, workspaceId])
    return team
}

export default function Search() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const team = useTeam()
    const t = useTranslations('mobileHome')
    const [query, setQuery] = useState('')
    const [collapsed, setCollapsed] = useState<string[]>([])
    const toggle = (key: string) => setCollapsed(current => (current.includes(key) ? current.filter(entry => entry !== key) : [...current, key]))
    const { scope, text } = parseQuery(query)

    const coworkers = useMemo(() => team?.coworkers ?? [], [team])
    const boxNames = useMemo(() => new Map((team?.boxes ?? []).map(box => [box.id, box.name || t('untitledBox')])), [team, t])
    const foundCoworkers = scope === 'commands' ? [] : searchItems(coworkers.map(coworker => ({ coworker, label: coworker.name, keywords: [coworker.handle ?? '', boxNames.get(coworker.spaceId) ?? ''] })), text).map(entry => entry.coworker)
    const hits = useConversationHits(text, scope === 'all' && text.length >= MIN_CONVERSATION_QUERY)
    const byId = new Map(coworkers.map(coworker => [coworker.id, coworker]))
    const asked = query.trim()

    const openCoworker = (coworker: HomeCoworker) => router.push({ pathname: '/chat/[id]', params: { id: coworker.latest?.id ?? 'new', to: coworker.id } })
    const askRerun = (text: string) => {
        setPendingAsk(text)
        router.push({ pathname: '/chat/[id]', params: { id: 'new' } })
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
                <GlassButton symbol="chevron.left" label={t('search.back')} onPress={() => router.back()} />
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: theme.muted }}>
                    <SymbolView name="magnifyingglass" size={15} tintColor={theme.mutedForeground} />
                    <TextInput value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} placeholderTextColor={theme.mutedForeground} autoFocus autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing" style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: theme.foreground }} />
                </View>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
                {asked.length > 0 && scope !== 'agents' && (
                    <Pressable onPress={() => askRerun(asked)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, backgroundColor: pressed ? theme.muted : 'transparent' })}>
                        <ForemanOrb size={28} />
                        <View style={{ flex: 1, gap: 1 }}>
                            <AppText variant="callout" medium>
                                {t('search.askRerun')}
                            </AppText>
                            <AppText variant="footnote" tone="muted" numberOfLines={1}>
                                {t('search.quotedAsk', { query: asked })}
                            </AppText>
                        </View>
                    </Pressable>
                )}
                {foundCoworkers.length > 0 && (
                    <>
                        <SectionHeader label={t('search.coworkers')} count={foundCoworkers.length} collapsed={collapsed.includes('coworkers')} onToggle={() => toggle('coworkers')} divided={asked.length > 0 && scope !== 'agents'} />
                        {!collapsed.includes('coworkers') && foundCoworkers.map(coworker => (
                            <CoworkerRow key={coworker.id} coworker={{ id: coworker.id, kind: 'coworker', name: coworker.name, status: moodStatus(coworker) }} line={lineOf(coworker, t)} minutesAgo={minutesSince(coworker.latest?.updatedAt)} unread={coworker.pending > 0} onPress={() => openCoworker(coworker)} />
                        ))}
                    </>
                )}
                {hits.length > 0 && (
                    <>
                        <SectionHeader label={t('search.conversations')} count={hits.length} collapsed={collapsed.includes('conversations')} onToggle={() => toggle('conversations')} divided />
                        {!collapsed.includes('conversations') && hits.map(hit => (
                            <ConversationRow key={hit.id} hit={hit} coworker={byId.get(hit.agentId)} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: hit.id, to: hit.agentId } })} />
                        ))}
                    </>
                )}
                {asked.length > 0 && foundCoworkers.length === 0 && hits.length === 0 && scope === 'agents' && (
                    <AppText variant="callout" tone="muted" style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
                        {t('search.noCoworker')}
                    </AppText>
                )}
            </ScrollView>
        </View>
    )
}
