import { FOREMAN_AGENT_ID, sectionsByBox, withPinned } from '@rerun/contracts'
import { router, useFocusEffect, useGlobalSearchParams, usePathname, type Href } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import Animated, { FadeIn, FadeOut, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { useAuth } from '@/auth/AuthProvider'
import { BuddyClock } from '@/components/buddy/motion'
import { coworkerEndpoints } from '@/chat/endpoints'
import { preloadGenerals } from '@/chat/preload'
import { foremanOnBoard, lineOf, minutesSince, moodStatus, recentCoworkers, type HomeCoworker } from '@/components/home/board'
import { SkeletonFade, useBootFill } from '@/components/home/BootFill'
import { generalHref } from '@/components/chat/conversation-pages'
import { LAST_CONVERSATION } from '@/components/chat/ForemanChat'
import { CoworkerRow, HOME_GUTTER } from '@/components/home/CoworkerRow'
import { ForemanRow } from '@/components/home/ForemanRow'
import { HomeBottomBar, bottomBarInset } from '@/components/home/HomeBottomBar'
import { HomeHeader } from '@/components/home/HomeHeader'
import { HomeSkeleton } from '@/components/home/HomeSkeleton'
import { PinnedAvatar, PinnedGrid, usePinnedCell } from '@/components/home/PinnedGrid'
import { SectionHeader } from '@/components/home/SectionHeader'
import { SortableGrid } from '@/components/home/SortableGrid'
import { useForemanLast } from '@/components/home/useForemanLast'
import { useGroupMode } from '@/components/home/useGroupMode'
import { usePinnedAgents } from '@/components/home/usePinnedAgents'
import { usePaneInsets } from '@/components/layout/PaneSize'
import { inboxCount } from '@/components/inbox/inbox'
import { AppText } from '@/components/ui/AppText'
import { EdgeFade } from '@/components/ui/EdgeFade'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { PillButton } from '@/components/ui/PillButton'
import { loadTranscript } from '@/data/local-cache'
import { useInbox } from '@/data/InboxProvider'
import { useBoard } from '@/data/useBoard'
import { startTiming } from '@/perf/timing'
import { layoutTransition as layout } from '@/theme/motion'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// The Home has drawn and settled before anything is read in the background.
const PRELOAD_AFTER_MS = 1500

// A wide window draws the Home as a sidebar beside the conversation: a tap swaps the conversation
// instead of stacking one more screen, and the row of the open one stays lit.
export function HomeScreen({ sidebar = false }: { sidebar?: boolean }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const pane = usePaneInsets()
    const topBar = usePaneInsets({ clearWindowControls: true })
    const { session, me } = useAuth()
    const board = useBoard()
    const inbox = useInbox()
    const [group] = useGroupMode()
    const [collapsed, setCollapsed] = useState<string[]>([])
    const fill = useBootFill(board.state === 'ready')
    const t = useTranslations('mobileHome')

    // A conversation pushed over the Home covers its buddies: they stand still until it is back.
    const covered = useSharedValue(false)
    useFocusEffect(
        useCallback(() => {
            covered.set(false)
            return () => {
                covered.set(true)
            }
        }, [covered])
    )

    const pathname = usePathname()
    const { to } = useGlobalSearchParams<{ to?: string }>()
    const openAgentId = sidebar && pathname.startsWith('/chat/') ? (to ?? FOREMAN_AGENT_ID) : null
    const go = (href: Href) => {
        if (!sidebar) return router.push(href)
        if (router.canDismiss()) router.dismissAll()
        router.replace(href)
    }

    const openForeman = () => go({ pathname: '/chat/[id]', params: { id: LAST_CONVERSATION } })

    const foreman = useForemanLast()
    const pins = usePinnedAgents()
    const cell = usePinnedCell()
    const [reordering, setReordering] = useState(false)
    const foremanPinned = pins.pinned.includes(FOREMAN_AGENT_ID)
    const { pinned, others } = withPinned(board.state === 'ready' ? board.coworkers : [], pins.pinned, board.state === 'ready' ? foremanOnBoard(foreman.running) : undefined)
    const sections = board.state === 'ready' && group === 'box' ? sectionsByBox(others, board.boxes, t('untitledBox')) : []
    const recent = board.state === 'ready' && group === 'recent' ? recentCoworkers(others) : []

    // Once the Home has the hub's rows, the Generals of the coworkers talked to last are read in the
    // background, for the next tap to open at once.
    const coworkersRead = board.state === 'ready' && board.fresh ? board.coworkers : null
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    useEffect(() => {
        if (!coworkersRead || !accessToken || workspaceId === undefined) return
        const timer = setTimeout(() => void preloadGenerals({ accessToken, workspaceId }, coworkersRead), PRELOAD_AFTER_MS)
        return () => clearTimeout(timer)
    }, [coworkersRead, accessToken, workspaceId])

    const open = (coworker: HomeCoworker) => {
        startTiming('chat open', 'chat fresh')
        if (coworker.id === FOREMAN_AGENT_ID) return openForeman()
        go(generalHref(coworker.id, coworker.generalSessionId))
    }

    const warmUp = (coworker: HomeCoworker) => {
        const sessionId = coworker.generalSessionId
        if (!sessionId || !session || !me) return
        const caller = { accessToken: session.access_token, workspaceId: me.workspace.id }
        loadTranscript(caller.workspaceId, sessionId, etag => coworkerEndpoints(coworker.id).messages(caller, sessionId, etag)).catch(() => {})
    }

    const togglePin = (coworker: HomeCoworker) => (pins.pinned.includes(coworker.id) ? pins.unpin(coworker.id) : pins.pin(coworker.id))

    const coworkerRow = (coworker: HomeCoworker) => <CoworkerRow coworker={{ id: coworker.id, kind: 'coworker', name: coworker.name, status: moodStatus(coworker) }} line={lineOf(coworker, t)} minutesAgo={minutesSince(coworker.latest?.updatedAt)} unread={coworker.pending > 0} selected={openAgentId === coworker.id} onPress={() => open(coworker)} onPressIn={() => warmUp(coworker)} pin={{ pinned: pins.pinned.includes(coworker.id), onToggle: () => togglePin(coworker) }} />

    const toggle = (key: string) => setCollapsed(current => (current.includes(key) ? current.filter(entry => entry !== key) : [...current, key]))
    const headerHeight = insets.top + spacing.sm + GLASS_BUTTON_SIZE

    return (
        <BuddyClock resting={covered}>
            <View style={{ flex: 1, backgroundColor: theme.background }}>
                <ScrollView scrollEnabled={!reordering} contentContainerStyle={{ paddingTop: headerHeight + spacing.xl, paddingBottom: insets.bottom + 120, paddingLeft: pane.left, paddingRight: pane.right }} contentInsetAdjustmentBehavior="never">
                    {board.state === 'loading' && <HomeSkeleton />}

                    {board.state === 'error' && (
                        <View style={{ alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: HOME_GUTTER, paddingTop: spacing.lg }}>
                            <AppText variant="callout" tone="muted">
                                {t('loadFailed')}
                            </AppText>
                            <PillButton label={t('retry')} variant="secondary" onPress={board.reload} />
                        </View>
                    )}

                    <View>
                        {pinned.length > 0 && (
                            <Animated.View layout={layout} entering={fill.playing ? fill.rowEntering(0) : undefined} style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
                                {reordering && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: HOME_GUTTER, paddingVertical: spacing.sm }}>
                                        <AppText variant="footnote" tone="muted" medium style={{ flex: 1 }}>
                                            {t('pinned.dragToReorder')}
                                        </AppText>
                                        <Pressable onPress={() => setReordering(false)} accessibilityRole="button" hitSlop={10}>
                                            <AppText variant="footnote" medium style={{ color: theme.foreground }}>
                                                {t('pinned.done')}
                                            </AppText>
                                        </Pressable>
                                    </View>
                                )}
                                {reordering ? (
                                    <View style={{ paddingHorizontal: HOME_GUTTER }}>
                                        <SortableGrid items={pinned} columns={cell.columns} cellWidth={cell.width} renderCell={coworker => <PinnedAvatar coworker={coworker} cell={cell} animated={false} />} onReorder={pins.reorder} />
                                    </View>
                                ) : (
                                    <PinnedGrid coworkers={pinned} onOpen={open} onUnpin={coworker => pins.unpin(coworker.id)} onDetails={coworker => router.push({ pathname: '/coworker/[id]', params: { id: coworker.id, name: coworker.name } })} onEdit={pinned.length > 1 ? () => setReordering(true) : undefined} />
                                )}
                            </Animated.View>
                        )}

                        {board.state === 'ready' && !foremanPinned && (
                            <Animated.View key="foreman" layout={layout} entering={fill.playing ? fill.rowEntering(0) : FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
                                <ForemanRow last={foreman} selected={openAgentId === FOREMAN_AGENT_ID} onPress={openForeman} pin={{ pinned: false, onToggle: () => pins.pin(FOREMAN_AGENT_ID) }} />
                            </Animated.View>
                        )}

                        {board.state === 'ready' && board.coworkers.length === 0 && (
                            <AppText variant="callout" tone="muted" style={{ paddingHorizontal: HOME_GUTTER, paddingTop: spacing.lg }}>
                                {t('empty')}
                            </AppText>
                        )}

                        {recent.map((coworker, index) => (
                            <Animated.View key={`recent:${coworker.id}`} layout={layout} entering={fill.rowEntering(index + 1)} exiting={FadeOut.duration(120)}>
                                {coworkerRow(coworker)}
                            </Animated.View>
                        ))}

                        {sections.map((section, index) => (
                            <Animated.View key={`box:${section.key}`} layout={layout} entering={fill.playing ? fill.rowEntering(index + 1) : undefined}>
                                <SectionHeader label={section.label} count={section.members.length} collapsed={collapsed.includes(section.key)} onToggle={() => toggle(section.key)} />
                                {!collapsed.includes(section.key) &&
                                    section.members.map(coworker => (
                                        <Animated.View key={coworker.id} layout={layout} entering={fill.playing ? undefined : FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
                                            {coworkerRow(coworker)}
                                        </Animated.View>
                                    ))}
                            </Animated.View>
                        ))}

                        {fill.playing && <SkeletonFade reveal={fill.reveal} staggered={fill.staggered} />}
                    </View>
                </ScrollView>

                <EdgeFade edge="top" height={headerHeight + spacing.xl} />
                <EdgeFade edge="bottom" height={insets.bottom + 90} />
                <Animated.View entering={fill.chromeEntering} pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + spacing.sm, left: topBar.left, right: topBar.right }}>
                    <HomeHeader inboxCount={inbox.state === 'ready' ? inboxCount(inbox.items) : 0} onInbox={() => router.push('/inbox')} onNewCoworker={() => router.push('/new-coworker')} />
                </Animated.View>
                <Animated.View entering={fill.chromeEntering} pointerEvents="box-none" style={{ position: 'absolute', left: pane.left, right: pane.right, bottom: bottomBarInset(insets.bottom) }}>
                    <HomeBottomBar onSearch={() => router.push('/search')} />
                </Animated.View>
            </View>
        </BuddyClock>
    )
}
